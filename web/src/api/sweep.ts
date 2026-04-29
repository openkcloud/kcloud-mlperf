import { httpClient } from '@/libs/http-client';

// ----------------------------------------------------------------------

export type SweepDisabledReason =
  | 'feature_flag_off'
  | 'node_not_ready'
  | 'device_plugin_missing'
  | 'no_model_artifact'
  | 'missing_permission'
  | 'node_pending_join';

export type SweepOptionFlag = {
  key: string;
  label: string;
  enabled: boolean;
  disabled_reason: SweepDisabledReason | null;
};

export type SweepNodeOption = {
  name: string;
  state: string;
  enabled: boolean;
  disabled_reason: SweepDisabledReason | null;
};

export type SweepHardwareOption = SweepOptionFlag & {
  vendor: string;
  node: string | null;
};

export type SweepModelOption = SweepOptionFlag & {
  precisions: string[];
};

export type SweepOptionsResponse = {
  enabled: boolean;
  feature_flag_reason: SweepDisabledReason | null;
  benchmarks: SweepOptionFlag[];
  hardware: SweepHardwareOption[];
  nodes: SweepNodeOption[];
  models: SweepModelOption[];
  precisions: SweepOptionFlag[];
  scenarios: SweepOptionFlag[];
  batch_sizes: number[];
  concurrencies: number[];
};

// Human-readable explanation surfaced as a tooltip on disabled options.
export const DISABLED_REASON_LABEL: Record<SweepDisabledReason, string> = {
  feature_flag_off:
    'GPU_SWEEP_ENABLED is false in this environment — sweep options are read-only.',
  node_not_ready: 'Target node is not Ready in the cluster.',
  device_plugin_missing:
    'Device plugin (DaemonSet) is not running on the target node.',
  no_model_artifact: 'Required model artifact has not been published.',
  missing_permission: 'Caller is not authorised for this option.',
  node_pending_join:
    'Node has not yet joined the cluster — the operator is waiting on Lane C-mut.'
};

// ----------------------------------------------------------------------

export const SweepApi = {
  options: async (): Promise<SweepOptionsResponse> => {
    const { data } = await httpClient.get<SweepOptionsResponse>(
      '/gpu-sweep/options'
    );
    return data;
  }
} as const;
