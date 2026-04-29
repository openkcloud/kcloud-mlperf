import type { DeviceEntry, NodeSummary, RegistryHealth } from '@/api/types/devices.types';
import { httpClient } from '@/libs/http-client';

export const DevicesApi = {
  list: async () => {
    const { data } = await httpClient.get<DeviceEntry[]>('/api/devices');
    return data ?? [];
  },

  nodes: async () => {
    const { data } = await httpClient.get<NodeSummary[]>('/api/devices/nodes');
    return data ?? [];
  },

  health: async () => {
    const { data } = await httpClient.get<RegistryHealth>('/api/devices/health');
    return data;
  }
} as const;
