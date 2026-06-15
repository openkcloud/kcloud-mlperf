/**
 * Registry-driven dashboard test suite.
 *
 * Authored under Lane H-frontend (worker-12). Test harness wiring (vitest +
 * @testing-library/react) lands in Lane I-frontend (task #14). Until then this
 * file is excluded from `tsc -b` via tsconfig.app.json.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DeviceEntry } from '@/api/types/devices.types';
import { DeviceRealtimeDashboard } from '@/components/DeviceRealtimeDashboard';

// -----------------------------------------------------------------------
// Fixtures (worker-11 contract: vendor=lowercase, model=mixed, slot_id=number)
// -----------------------------------------------------------------------

const FIXTURE_EMPTY: DeviceEntry[] = [];

const FIXTURE_4_GPU: DeviceEntry[] = [
  {
    node: 'node2',
    type: 'gpu',
    vendor: 'nvidia',
    model: 'L40',
    slot_id: 0,
    state: 'ready',
    k8s_node_status: 'Ready',
    allocatable_resource_name: 'nvidia.com/gpu',
    allocatable_count: 2,
    source: 'k8s'
  },
  {
    node: 'node2',
    type: 'gpu',
    vendor: 'nvidia',
    model: 'A40',
    slot_id: 1,
    state: 'ready',
    k8s_node_status: 'Ready',
    allocatable_resource_name: 'nvidia.com/gpu',
    allocatable_count: 2,
    source: 'k8s'
  },
  {
    node: 'node3',
    type: 'gpu',
    vendor: 'nvidia',
    model: 'L40-44GiB',
    slot_id: 0,
    state: 'ready',
    k8s_node_status: 'Ready',
    allocatable_resource_name: 'nvidia.com/gpu',
    allocatable_count: 2,
    source: 'k8s'
  },
  {
    node: 'node3',
    type: 'gpu',
    vendor: 'nvidia',
    model: 'A40-44GiB',
    slot_id: 1,
    state: 'ready',
    k8s_node_status: 'Ready',
    allocatable_resource_name: 'nvidia.com/gpu',
    allocatable_count: 2,
    source: 'k8s'
  }
];

const FIXTURE_GPU_PLUS_NPU: DeviceEntry[] = [
  ...FIXTURE_4_GPU,
  {
    node: 'node4',
    type: 'npu',
    vendor: 'furiosa',
    model: 'RNGD',
    slot_id: 0,
    state: 'ready',
    k8s_node_status: 'Ready',
    allocatable_resource_name: 'furiosa.ai/npu',
    allocatable_count: 1,
    source: 'k8s'
  },
  {
    node: 'node5',
    type: 'npu',
    vendor: 'rebellions',
    model: 'Atom+',
    slot_id: 0,
    state: 'pending_join',
    k8s_node_status: 'Absent',
    allocatable_resource_name: 'rebellions.ai/ATOM',
    allocatable_count: null,
    source: 'k8s'
  }
];

// -----------------------------------------------------------------------
// Mocks
// -----------------------------------------------------------------------

vi.mock('@/hooks/useRealtimeExams', () => ({
  useRealtimeExams: () => ({
    snapshot: {
      slots: [],
      sweep_progress: { completed: 0, total: 96, paused: true },
      operator_race_alerts: 0,
      timestamp: ''
    },
    connected: true,
    error: null,
    // DeviceCard indexes telemetryHistory[key]; the real hook always returns an
    // object (defaults to {}), so the mock must too or DeviceCard throws.
    telemetryHistory: {}
  }),
  // Mirror the real module export consumed by DeviceCard — without it the
  // mocked module returns undefined and DeviceCard throws on render.
  telemetryHistoryKey: (node: string, slot_id: number) => `${node}/${slot_id}`
}));

const mockUseDeviceRegistry = vi.fn();
vi.mock('@/hooks/useDeviceRegistry', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useDeviceRegistry')>(
    '@/hooks/useDeviceRegistry'
  );
  return {
    ...actual,
    useDeviceRegistry: (opts?: { deviceType?: 'gpu' | 'npu' | 'all' }) =>
      mockUseDeviceRegistry(opts)
  };
});

const renderWithClient = (node: ReactNode) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
};

beforeEach(() => {
  mockUseDeviceRegistry.mockReset();
});

const baseResult = (
  devices: DeviceEntry[],
  extra: Partial<{ isLoading: boolean; error: Error | null }> = {}
) => ({
  devices,
  allDevices: devices,
  nodes: [],
  health: null,
  isLoading: extra.isLoading ?? false,
  isFetching: false,
  error: extra.error ?? null
});

// -----------------------------------------------------------------------

describe('DeviceRealtimeDashboard (registry-driven)', () => {
  it('renders an empty-registry fallback when /api/devices returns no devices', () => {
    mockUseDeviceRegistry.mockReturnValue(baseResult(FIXTURE_EMPTY));

    renderWithClient(<DeviceRealtimeDashboard deviceType="gpu" />);

    expect(screen.getByText(/No GPU devices registered/i)).toBeInTheDocument();
    expect(screen.queryByText(/L40/)).not.toBeInTheDocument();
  });

  it('renders a card per device for the 4-GPU registry', () => {
    mockUseDeviceRegistry.mockReturnValue(baseResult(FIXTURE_4_GPU));

    renderWithClient(<DeviceRealtimeDashboard deviceType="gpu" />);

    // Vendor + model badges via deviceLabel: 'NVIDIA L40' etc.
    expect(screen.getByText(/NVIDIA L40$/)).toBeInTheDocument();
    expect(screen.getByText(/NVIDIA A40$/)).toBeInTheDocument();
    expect(screen.getByText(/NVIDIA L40-44GiB/)).toBeInTheDocument();
    expect(screen.getByText(/NVIDIA A40-44GiB/)).toBeInTheDocument();
    // NVIDIA vendor chip appears on every card
    expect(screen.getAllByText('NVIDIA').length).toBeGreaterThanOrEqual(4);
  });

  it('renders distinct vendor badges for GPU + NPU registry', () => {
    mockUseDeviceRegistry.mockReturnValue(baseResult(FIXTURE_GPU_PLUS_NPU));

    renderWithClient(<DeviceRealtimeDashboard deviceType="all" />);

    expect(screen.getAllByText(/RNGD/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Atom\+/).length).toBeGreaterThanOrEqual(1);
    // Distinct vendor chips
    expect(screen.getAllByText('FuriosaAI').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Rebellions').length).toBeGreaterThanOrEqual(1);
    // Pending-join state surfaced for node5 Atom+
    expect(screen.getByText(/Pending Join/i)).toBeInTheDocument();
  });

  it('passes deviceType to the registry hook', () => {
    mockUseDeviceRegistry.mockReturnValue(
      baseResult(FIXTURE_GPU_PLUS_NPU.filter(d => d.type === 'npu'))
    );

    renderWithClient(<DeviceRealtimeDashboard deviceType="npu" />);

    expect(mockUseDeviceRegistry).toHaveBeenCalledWith({ deviceType: 'npu' });
  });

  it('shows a loading state while the registry resolves', () => {
    mockUseDeviceRegistry.mockReturnValue(baseResult([], { isLoading: true }));

    renderWithClient(<DeviceRealtimeDashboard deviceType="gpu" />);

    expect(screen.getByText(/Loading device registry/i)).toBeInTheDocument();
  });

  it('shows a registry error message when /api/devices fails', () => {
    mockUseDeviceRegistry.mockReturnValue(baseResult([], { error: new Error('boom') }));

    renderWithClient(<DeviceRealtimeDashboard deviceType="gpu" />);

    expect(screen.getByText(/Device registry unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/boom/)).toBeInTheDocument();
  });
});
