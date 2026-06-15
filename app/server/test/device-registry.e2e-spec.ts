import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DeviceRegistryController } from '../src/device-registry/device-registry.controller';
import {
  DeviceRegistryService,
  K8sClient,
} from '../src/device-registry/device-registry.service';

const CLUSTER_YAML_FIXTURE = `
cluster_name: etri-llm-bench-test

control_plane:
  - name: node1
    role: master
    accelerator: { type: cpu, vendor: intel, count: 0 }
    ssh: { host: 10.0.0.1, port: 122 }

workers:
  - name: node2
    role: worker
    accelerator: { type: gpu, vendor: nvidia, model: "L40 + A40", count: 2 }
    ssh: { host: 10.0.0.2, port: 122 }
    labels:
      accelerator-type: gpu
      gpu-vendor: nvidia

  - name: node3
    role: worker
    accelerator: { type: gpu, vendor: nvidia, model: "L40-44GiB + A40-44GiB", count: 2 }
    ssh: { host: 10.0.0.3, port: 122 }
    labels:
      accelerator-type: gpu

  - name: node4
    role: worker
    accelerator: { type: npu, vendor: furiosa, model: "RNGD", count: 1 }
    ssh: { host: 10.0.0.4, port: 22 }
    labels:
      accelerator-type: npu
      npu-vendor: furiosa

  - name: node5
    role: worker
    state: pending_join
    accelerator: { type: npu, vendor: rebellions, model: "Atom+", count: 2 }
    ssh: { host: 10.0.0.5, port: 22 }
    labels:
      accelerator-type: npu
      npu-vendor: rebellions
`;

function k8sClientWithAllNodesReady(): K8sClient {
  return {
    listNodes: async () => [
      {
        name: 'node1',
        status: 'Ready' as const,
        labels: {} as Record<string, string>,
        allocatable: { cpu: '8', memory: '32Gi' } as Record<string, string>,
      },
      {
        name: 'node2',
        status: 'Ready',
        labels: { 'accelerator-type': 'gpu' },
        allocatable: { 'nvidia.com/gpu': '2', cpu: '32' },
      },
      {
        name: 'node3',
        status: 'Ready',
        labels: { 'accelerator-type': 'gpu' },
        allocatable: { 'nvidia.com/gpu': '2', cpu: '32' },
      },
      {
        name: 'node4',
        status: 'Ready',
        labels: { 'accelerator-type': 'npu', 'npu-vendor': 'furiosa' },
        allocatable: { 'furiosa.ai/npu': '1', cpu: '16' },
      },
      // node5 NOT in k8s — pending_join
    ],
  };
}

function unreachableK8sClient(): K8sClient {
  return {
    listNodes: () =>
      Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:6443')),
  };
}

interface DeviceShape {
  node: string;
  type: string;
  vendor: string;
  model: string;
  slot_id: number;
  state: string;
  k8s_node_status: string;
  allocatable_resource_name: string | null;
  allocatable_count: number | null;
  source: string;
}

interface NodeShape {
  name: string;
  role: string;
  state: string;
  k8s_node_status: string;
  accelerator_type: string;
  accelerator_vendor: string | null;
  accelerator_model: string | null;
  accelerator_count: number;
  device_plugin_detected: boolean;
  source: string;
}

interface HealthShape {
  cluster_yaml_readable: boolean;
  cluster_yaml_path: string;
  k8s_api_reachable: boolean;
  k8s_api_error: string | null;
  source_used: string;
  device_plugins: Record<string, boolean>;
  last_refresh: string;
}

function asArray<T>(body: unknown): T[] {
  if (Array.isArray(body)) return body as T[];
  const data = (body as { data?: unknown })?.data;
  return Array.isArray(data) ? (data as T[]) : [];
}

function asObject<T>(body: unknown): T {
  const data = (body as { data?: unknown })?.data;
  return (data ?? body) as T;
}

async function makeApp(
  yamlPath: string,
  k8sClient: K8sClient,
): Promise<INestApplication<App>> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    controllers: [DeviceRegistryController],
    providers: [
      {
        provide: DeviceRegistryService,
        useFactory: () => new DeviceRegistryService(yamlPath, k8sClient),
      },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  await app.init();
  return app;
}

describe('DeviceRegistry (e2e)', () => {
  let yamlPath: string;
  let app: INestApplication<App>;

  beforeAll(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'device-registry-'));
    yamlPath = path.join(dir, 'cluster.yaml');
    fs.writeFileSync(yamlPath, CLUSTER_YAML_FIXTURE, 'utf8');
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  describe('with k8s API reachable (all 4 worker nodes ready, node5 absent)', () => {
    beforeEach(async () => {
      app = await makeApp(yamlPath, k8sClientWithAllNodesReady());
    });

    it('GET /api/devices returns devices for all 5 nodes worth of slots', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/devices')
        .expect(200);

      const devices = asArray<DeviceShape>(res.body);
      expect(Array.isArray(devices)).toBe(true);

      // Expect: node1 cpu (1) + node2 gpu (2) + node3 gpu (2) + node4 npu (1) + node5 npu (2) = 8
      const nonCpu = devices.filter((d) => d.type !== 'cpu');
      expect(nonCpu.length).toBe(7);

      const node2 = devices.filter((d) => d.node === 'node2');
      expect(node2).toHaveLength(2);
      expect(node2.map((d) => d.model).sort()).toEqual(['A40', 'L40']);
      for (const d of node2) {
        expect(d.type).toBe('gpu');
        expect(d.vendor).toBe('nvidia');
        expect(d.state).toBe('ready');
        expect(d.k8s_node_status).toBe('Ready');
        expect(d.allocatable_resource_name).toBe('nvidia.com/gpu');
        expect(d.allocatable_count).toBe(2);
      }

      const node4 = devices.filter((d) => d.node === 'node4');
      expect(node4).toHaveLength(1);
      expect(node4[0].type).toBe('npu');
      expect(node4[0].vendor).toBe('furiosa');
      expect(node4[0].model).toBe('RNGD');
      expect(node4[0].state).toBe('ready');
      expect(node4[0].allocatable_resource_name).toBe('furiosa.ai/npu');
    });

    it('node5 (pending_join) is rebellions Atom+ with 2 slots and pending_join state', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/devices')
        .expect(200);
      const devices = asArray<DeviceShape>(res.body);

      const node5 = devices.filter((d) => d.node === 'node5');
      expect(node5).toHaveLength(2);
      for (const d of node5) {
        expect(d.type).toBe('npu');
        expect(d.vendor).toBe('rebellions');
        expect(d.model).toBe('Atom+');
        expect(d.state).toBe('pending_join');
        expect(d.k8s_node_status).toBe('Absent');
        expect(d.allocatable_resource_name).toBe('rebellions.ai/ATOM');
        expect(d.allocatable_count).toBeNull();
      }
      expect(node5.map((d) => d.slot_id).sort()).toEqual([0, 1]);
    });

    it('vendor distinguishes furiosa (node4) from rebellions (node5)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/devices')
        .expect(200);
      const devices = asArray<DeviceShape>(res.body);

      const vendors = new Set(
        devices.filter((d) => d.type === 'npu').map((d) => d.vendor),
      );
      expect(vendors.has('furiosa')).toBe(true);
      expect(vendors.has('rebellions')).toBe(true);
      expect(vendors.size).toBe(2);
    });

    it('GET /api/devices/nodes returns 5-node summary', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/devices/nodes')
        .expect(200);
      const nodes = asArray<NodeShape>(res.body);

      expect(nodes).toHaveLength(5);
      const byName = new Map<string, NodeShape>(
        nodes.map((n) => [n.name, n] as const),
      );

      expect(byName.get('node1')!.role).toBe('master');
      expect(byName.get('node1')!.accelerator_type).toBe('cpu');

      expect(byName.get('node2')!.state).toBe('ready');
      expect(byName.get('node2')!.accelerator_count).toBe(2);
      expect(byName.get('node2')!.device_plugin_detected).toBe(true);

      expect(byName.get('node4')!.accelerator_vendor).toBe('furiosa');
      expect(byName.get('node4')!.device_plugin_detected).toBe(true);

      const node5 = byName.get('node5')!;
      expect(node5.state).toBe('pending_join');
      expect(node5.k8s_node_status).toBe('Absent');
      expect(node5.accelerator_vendor).toBe('rebellions');
      expect(node5.device_plugin_detected).toBe(false);
    });

    it('GET /api/devices/health reports k8s reachable and source=k8s', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/devices/health')
        .expect(200);
      const health = asObject<HealthShape>(res.body);

      expect(health.cluster_yaml_readable).toBe(true);
      expect(health.cluster_yaml_path).toBe(yamlPath);
      expect(health.k8s_api_reachable).toBe(true);
      expect(health.k8s_api_error).toBeNull();
      expect(health.source_used).toBe('k8s');
      expect(health.device_plugins.node2).toBe(true);
      expect(health.device_plugins.node4).toBe(true);
      expect(health.device_plugins.node5).toBe(false);
      expect(typeof health.last_refresh).toBe('string');
    });
  });

  describe('with k8s API unreachable (cluster.yaml fallback)', () => {
    beforeEach(async () => {
      app = await makeApp(yamlPath, unreachableK8sClient());
    });

    it('falls back to cluster.yaml — devices still served', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/devices')
        .expect(200);
      const devices = asArray<DeviceShape>(res.body);
      expect(Array.isArray(devices)).toBe(true);
      const nonCpu = devices.filter((d) => d.type !== 'cpu');
      expect(nonCpu.length).toBe(7);

      const node2 = devices.filter((d) => d.node === 'node2');
      for (const d of node2) {
        expect(d.k8s_node_status).toBe('Absent');
        expect(d.source).toBe('cluster_yaml');
      }
    });

    it('health reports k8s_api_reachable=false with error message', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/devices/health')
        .expect(200);
      const health = asObject<HealthShape>(res.body);

      expect(health.cluster_yaml_readable).toBe(true);
      expect(health.k8s_api_reachable).toBe(false);
      expect(health.k8s_api_error).toMatch(/ECONNREFUSED|unreachable|Error/i);
      expect(health.source_used).toBe('cluster_yaml');
    });
  });

  describe('with cluster.yaml unreadable', () => {
    beforeEach(async () => {
      app = await makeApp('/nonexistent/path.yaml', unreachableK8sClient());
    });

    it('health reports cluster_yaml_readable=false and devices is empty', async () => {
      const healthRes = await request(app.getHttpServer())
        .get('/api/devices/health')
        .expect(200);
      const health = asObject<HealthShape>(healthRes.body);
      expect(health.cluster_yaml_readable).toBe(false);

      const devRes = await request(app.getHttpServer())
        .get('/api/devices')
        .expect(200);
      const devices = asArray<DeviceShape>(devRes.body);
      expect(devices).toEqual([]);
    });
  });
});
