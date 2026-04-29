// Mirror of server/src/device-registry/device-registry.types.ts
// Owned by Lane H-backend (worker-11) — keep in sync.

export type DeviceType = 'gpu' | 'npu' | 'cpu';
export type DeviceVendor = 'nvidia' | 'furiosa' | 'rebellions' | 'intel';
export type DeviceState = 'ready' | 'pending_join' | 'not_ready' | 'degraded' | 'unknown';
export type RegistrySource = 'k8s' | 'cluster_yaml';
export type K8sNodeStatus = 'Ready' | 'NotReady' | 'Unknown' | 'Absent';

export interface DeviceEntry {
  node: string;
  type: DeviceType;
  vendor: DeviceVendor;
  model: string;
  slot_id: number;
  state: DeviceState;
  k8s_node_status: K8sNodeStatus;
  allocatable_resource_name: string | null;
  allocatable_count: number | null;
  source: RegistrySource;
}

export interface NodeSummary {
  name: string;
  role: 'master' | 'worker';
  state: DeviceState;
  k8s_node_status: K8sNodeStatus;
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
  /** ISO timestamp */
  last_refresh: string;
}
