import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';

import { DevicesApi } from '@/api/domains/devices.domains';
import type {
  DeviceEntry,
  DeviceType,
  DeviceVendor,
  NodeSummary,
  RegistryHealth
} from '@/api/types/devices.types';

import { DevicesQueryKeys } from '@/contexts/QueryContext/query.keys';

const STALE_TIME_MS = 30_000;

const VENDOR_LABEL: Record<DeviceVendor, string> = {
  nvidia: 'NVIDIA',
  furiosa: 'FuriosaAI',
  rebellions: 'Rebellions',
  intel: 'Intel'
};

/**
 * Build the legacy realtime slot key (matches RealtimeSlot.gpu_type emitted by
 * server/src/realtime/realtime.service.ts). Examples:
 *   nvidia + L40           -> 'NVIDIA-L40'
 *   nvidia + L40-44GiB     -> 'NVIDIA-L40-44GiB'
 *   furiosa + RNGD         -> 'FURIOSA-RNGD'
 *   rebellions + Atom+     -> 'REBELLIONS-Atom+'
 */
export const slotKeyFromDevice = (d: Pick<DeviceEntry, 'vendor' | 'model'>): string => {
  return `${d.vendor.toUpperCase()}-${d.model}`;
};

/** Human-readable label fallback used when no override is provided. */
export const deviceLabel = (d: Pick<DeviceEntry, 'vendor' | 'model'>): string => {
  return `${VENDOR_LABEL[d.vendor] ?? d.vendor} ${d.model}`;
};

type UseDeviceRegistryOptions = {
  /** Optional client-side filter. 'all' (default) returns gpu+npu (excludes cpu). */
  deviceType?: DeviceType | 'all';
};

export type UseDeviceRegistryResult = {
  /** Filtered device entries (per `options.deviceType`). */
  devices: DeviceEntry[];
  /** All device entries from the registry, unfiltered. */
  allDevices: DeviceEntry[];
  nodes: NodeSummary[];
  health: RegistryHealth | null;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
};

const filterByType = (devices: DeviceEntry[], deviceType: DeviceType | 'all'): DeviceEntry[] => {
  if (deviceType === 'all') return devices.filter(d => d.type !== 'cpu');
  return devices.filter(d => d.type === deviceType);
};

export const useDeviceRegistry = (
  options: UseDeviceRegistryOptions = {}
): UseDeviceRegistryResult => {
  const deviceType = options.deviceType ?? 'all';

  const results = useQueries({
    queries: [
      {
        queryKey: DevicesQueryKeys.list(),
        queryFn: DevicesApi.list,
        staleTime: STALE_TIME_MS
      },
      {
        queryKey: DevicesQueryKeys.nodes(),
        queryFn: DevicesApi.nodes,
        staleTime: STALE_TIME_MS
      },
      {
        queryKey: DevicesQueryKeys.health(),
        queryFn: DevicesApi.health,
        staleTime: STALE_TIME_MS
      }
    ]
  });

  const [devicesQ, nodesQ, healthQ] = results;

  const allDevices = useMemo(() => (devicesQ.data ?? []) as DeviceEntry[], [devicesQ.data]);

  const devices = useMemo(() => filterByType(allDevices, deviceType), [allDevices, deviceType]);

  const nodes = (nodesQ.data ?? []) as NodeSummary[];
  const health = (healthQ.data ?? null) as RegistryHealth | null;

  const isLoading = results.some(r => r.isLoading);
  const isFetching = results.some(r => r.isFetching);
  const firstError = (results.find(r => r.error)?.error as Error | undefined) ?? null;

  return { devices, allDevices, nodes, health, isLoading, isFetching, error: firstError };
};

export type { DeviceEntry, NodeSummary, RegistryHealth, DeviceType, DeviceVendor };
