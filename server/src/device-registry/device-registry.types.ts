export type DeviceType = 'gpu' | 'npu' | 'cpu';
export type DeviceVendor = 'nvidia' | 'furiosa' | 'rebellions' | 'intel';
export type DeviceState =
  | 'ready'
  | 'pending_join'
  | 'not_ready'
  | 'degraded'
  | 'unknown';

export type RegistrySource = 'k8s' | 'cluster_yaml';

export interface DeviceEntry {
  node: string;
  type: DeviceType;
  vendor: DeviceVendor;
  model: string;
  slot_id: number;
  state: DeviceState;
  k8s_node_status: 'Ready' | 'NotReady' | 'Unknown' | 'Absent';
  allocatable_resource_name: string | null;
  allocatable_count: number | null;
  source: RegistrySource;
}

export interface NodeSummary {
  name: string;
  role: 'master' | 'worker';
  state: DeviceState;
  k8s_node_status: 'Ready' | 'NotReady' | 'Unknown' | 'Absent';
  accelerator_type: DeviceType;
  accelerator_vendor: DeviceVendor | null;
  accelerator_model: string | null;
  accelerator_count: number;
  device_plugin_detected: boolean;
  source: RegistrySource;
}

export interface RegistryHealth {
  cluster_yaml_readable: boolean;
  cluster_yaml_path: string;
  k8s_api_reachable: boolean;
  k8s_api_error: string | null;
  source_used: RegistrySource;
  device_plugins: Record<string, boolean>;
  /**
   * Per-node detected resource name (e.g. "furiosa.ai/rngd"). Lets callers
   * see exactly which allocatable key satisfied the vendor lookup, instead of
   * just a boolean. Null when no candidate matched on that node.
   */
  device_plugin_resource: Record<string, string | null>;
  /**
   * Vendor-tagged warnings surfaced when the node advertises an allocatable
   * `<vendor>.ai/*` or `nvidia.com/*` resource that no candidate in
   * VENDOR_RESOURCE_CANDIDATES matched. Surfacing these prevents the silent
   * `device_plugins[node]=false` regression where a new NPU family name
   * (e.g. furiosa.ai/rngd vs furiosa.ai/npu) goes undetected.
   */
  device_plugin_warnings: string[];
  last_refresh: string;
}

export interface ClusterYamlNode {
  name: string;
  role?: 'master' | 'worker';
  state?: string;
  accelerator?: {
    type?: string;
    vendor?: string;
    model?: string;
    count?: number;
  };
  ssh?: { host?: string; port?: number };
  labels?: Record<string, string>;
}

export interface ClusterYaml {
  cluster_name?: string;
  control_plane?: ClusterYamlNode[];
  workers?: ClusterYamlNode[];
}

/**
 * First candidate per vendor used for the *display* `allocatable_resource_name`
 * in DeviceEntry. Kept for backwards compatibility with callers that read this
 * single string. Lookup of the *actual* allocatable count uses the full
 * VENDOR_RESOURCE_CANDIDATES list so that new NPU family names (e.g. RNGD
 * vs Warboy) don't silently regress device_plugins detection.
 */
export const RESOURCE_NAMES = {
  nvidia: 'nvidia.com/gpu',
  furiosa: 'furiosa.ai/rngd',
  // Resource advertised by rbln-npu-operator v0.3.3+ device plugin (config selectorList resourceName=ATOM).
  rebellions: 'rebellions.ai/ATOM',
} as const;

/**
 * All known allocatable resource names per vendor, ordered most-recent-first.
 * `resolveAllocatable` walks this list and returns the count for the first
 * match present on the node. Adding a new NPU family is one line here and a
 * unit test in device-registry.service.spec.ts.
 *
 * Why a list and not a single string: furiosa-device-plugin advertises
 * `furiosa.ai/<family>` (e.g. `furiosa.ai/rngd`, historically
 * `furiosa.ai/warboy`, future `furiosa.ai/<next>`). The legacy single-string
 * mapping silently set `device_plugins[node]=false` whenever the deployed
 * NPU family didn't match the hardcoded string. See post-outage report
 * 2026-05-18: RNGD was healthy but reported as plugin-missing.
 */
export const VENDOR_RESOURCE_CANDIDATES: Record<DeviceVendor, readonly string[]> = {
  nvidia: ['nvidia.com/gpu'],
  furiosa: ['furiosa.ai/rngd', 'furiosa.ai/npu', 'furiosa.ai/warboy'],
  rebellions: ['rebellions.ai/ATOM', 'rebellions.ai/npu'],
  intel: [],
} as const;
