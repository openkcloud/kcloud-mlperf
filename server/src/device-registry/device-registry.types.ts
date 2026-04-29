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

export const RESOURCE_NAMES = {
  nvidia: 'nvidia.com/gpu',
  furiosa: 'furiosa.ai/npu',
  // Resource advertised by rbln-npu-operator v0.3.3+ device plugin (config selectorList resourceName=ATOM).
  rebellions: 'rebellions.ai/ATOM',
} as const;
