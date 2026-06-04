/**
 * Regression-safeguards for the device-registry plugin detection.
 *
 * Why these tests exist:
 *   - 2026-05-18 incident: `device_plugins.node4` reported `false` while RNGD
 *     was serving inference correctly. Root cause: RESOURCE_NAMES.furiosa was
 *     hardcoded to "furiosa.ai/npu" but the deployed furiosa-device-plugin
 *     advertises "furiosa.ai/rngd". The lookup missed silently.
 *
 * What these tests lock down:
 *   1. The vendor → resource lookup walks the candidate list rather than a
 *      single hardcoded name, so a new NPU family on the cluster doesn't
 *      regress detection.
 *   2. When k8s advertises an unknown vendor-prefixed allocatable, the health
 *      payload surfaces a warning (`device_plugin_warnings`) instead of
 *      silently returning false.
 *   3. The detected resource per node is exposed in `device_plugin_resource`
 *      so callers can see WHICH key satisfied detection.
 */
import { DeviceRegistryService } from './device-registry.service';
import {
  ClusterYaml,
  VENDOR_RESOURCE_CANDIDATES,
} from './device-registry.types';

interface FakeK8sNode {
  name: string;
  status: 'Ready' | 'NotReady' | 'Unknown';
  labels: Record<string, string>;
  allocatable: Record<string, string>;
}

function makeService(
  yamlOverride: ClusterYaml,
  k8sNodes: FakeK8sNode[],
): DeviceRegistryService {
  const svc = new DeviceRegistryService('/nonexistent/cluster.yaml', {
    listNodes: async () => k8sNodes,
  });
  (svc as unknown as { clusterYaml: ClusterYaml }).clusterYaml = yamlOverride;
  return svc;
}

const baseYaml: ClusterYaml = {
  control_plane: [
    {
      name: 'node1',
      role: 'master',
      accelerator: { type: 'cpu', vendor: 'intel', count: 0 },
    },
  ],
  workers: [
    {
      name: 'node2',
      role: 'worker',
      accelerator: { type: 'gpu', vendor: 'nvidia', model: 'L40 + A40', count: 2 },
    },
    {
      name: 'node4',
      role: 'worker',
      accelerator: { type: 'npu', vendor: 'furiosa', model: 'RNGD', count: 1 },
    },
    {
      name: 'node5',
      role: 'worker',
      accelerator: { type: 'npu', vendor: 'rebellions', model: 'Atom+', count: 2 },
    },
  ],
};

describe('DeviceRegistryService — vendor resource candidate lookup', () => {
  it('detects furiosa device-plugin when allocatable advertises furiosa.ai/rngd (current cluster)', async () => {
    const svc = makeService(baseYaml, [
      { name: 'node2', status: 'Ready', labels: {}, allocatable: { 'nvidia.com/gpu': '2' } },
      { name: 'node4', status: 'Ready', labels: {}, allocatable: { 'furiosa.ai/rngd': '1' } },
      { name: 'node5', status: 'Ready', labels: {}, allocatable: { 'rebellions.ai/ATOM': '2' } },
    ]);
    const { health } = await svc.refresh();
    expect(health.device_plugins.node4).toBe(true);
    expect(health.device_plugin_resource.node4).toBe('furiosa.ai/rngd');
    expect(health.device_plugin_warnings).toEqual([]);
  });

  it('still detects furiosa when a future image reverts to legacy furiosa.ai/npu', async () => {
    const svc = makeService(baseYaml, [
      { name: 'node2', status: 'Ready', labels: {}, allocatable: { 'nvidia.com/gpu': '2' } },
      { name: 'node4', status: 'Ready', labels: {}, allocatable: { 'furiosa.ai/npu': '1' } },
      { name: 'node5', status: 'Ready', labels: {}, allocatable: { 'rebellions.ai/ATOM': '2' } },
    ]);
    const { health } = await svc.refresh();
    expect(health.device_plugins.node4).toBe(true);
    expect(health.device_plugin_resource.node4).toBe('furiosa.ai/npu');
  });

  it('emits a warning when k8s advertises an unknown vendor-prefixed allocatable', async () => {
    const svc = makeService(baseYaml, [
      { name: 'node2', status: 'Ready', labels: {}, allocatable: { 'nvidia.com/gpu': '2' } },
      // Hypothetical future family our candidate list doesn't know about yet.
      { name: 'node4', status: 'Ready', labels: {}, allocatable: { 'furiosa.ai/nextgen': '4' } },
      { name: 'node5', status: 'Ready', labels: {}, allocatable: { 'rebellions.ai/ATOM': '2' } },
    ]);
    const { health } = await svc.refresh();
    // Detection fails because no candidate matched...
    expect(health.device_plugins.node4).toBe(false);
    // ...but the warning makes that visible so we can't silently regress.
    expect(health.device_plugin_warnings.some((w) => w.includes('furiosa.ai/nextgen'))).toBe(true);
  });

  it('reports false when no allocatable resource is present for that vendor', async () => {
    const svc = makeService(baseYaml, [
      { name: 'node2', status: 'Ready', labels: {}, allocatable: { 'nvidia.com/gpu': '2' } },
      { name: 'node4', status: 'Ready', labels: {}, allocatable: {} },
      { name: 'node5', status: 'Ready', labels: {}, allocatable: { 'rebellions.ai/ATOM': '2' } },
    ]);
    const { health } = await svc.refresh();
    expect(health.device_plugins.node4).toBe(false);
    expect(health.device_plugin_resource.node4).toBeNull();
    expect(health.device_plugin_warnings).toEqual([]);
  });
});

describe('VENDOR_RESOURCE_CANDIDATES — vendor coverage', () => {
  it('covers every non-intel DeviceVendor with at least one candidate', () => {
    expect(VENDOR_RESOURCE_CANDIDATES.nvidia.length).toBeGreaterThan(0);
    expect(VENDOR_RESOURCE_CANDIDATES.furiosa.length).toBeGreaterThan(0);
    expect(VENDOR_RESOURCE_CANDIDATES.rebellions.length).toBeGreaterThan(0);
  });

  it('lists current cluster resources (regression lock from 2026-05-18 audit)', () => {
    expect(VENDOR_RESOURCE_CANDIDATES.nvidia).toContain('nvidia.com/gpu');
    expect(VENDOR_RESOURCE_CANDIDATES.furiosa).toContain('furiosa.ai/rngd');
    expect(VENDOR_RESOURCE_CANDIDATES.rebellions).toContain('rebellions.ai/ATOM');
  });
});
