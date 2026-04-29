/**
 * Sweep Control options-grid test suite.
 *
 * Authored under Lane G (worker-10). Test harness wiring (vitest +
 * @testing-library/react) lands in Lane I-frontend (task #14). This file is
 * excluded from `tsc -b` via tsconfig.app.json's __tests__ exclude rule.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import SweepControlPage from '@/pages/dashboard/sweep-control/index';
import type { SweepOptionsResponse } from '@/api/sweep';

// -----------------------------------------------------------------------
// Mocks
// -----------------------------------------------------------------------

const optionsMock = vi.fn();
vi.mock('@/api/sweep', async () => {
  const actual = await vi.importActual<typeof import('@/api/sweep')>('@/api/sweep');
  return {
    ...actual,
    SweepApi: { options: () => optionsMock() }
  };
});

// httpClient is used for /auth/me; default to non-admin so the page renders
// the read-only catalogue without surfacing the start/pause/drain buttons.
vi.mock('@/libs/http-client', () => ({
  httpClient: {
    get: vi.fn().mockRejectedValue({ response: { status: 401 } }),
    post: vi.fn(),
    patch: vi.fn()
  }
}));

// -----------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------

const FIXTURE_ENABLED: SweepOptionsResponse = {
  enabled: true,
  feature_flag_reason: null,
  benchmarks: [
    { key: 'mlperf-perf', label: 'MLPerf performance', enabled: true, disabled_reason: null },
    { key: 'mlperf-acc', label: 'MLPerf accuracy', enabled: true, disabled_reason: null },
    { key: 'mmlu-pro', label: 'MMLU-Pro', enabled: true, disabled_reason: null },
    { key: 'tt100', label: 'TT100', enabled: true, disabled_reason: null }
  ],
  hardware: [
    {
      key: 'gpu-nvidia',
      label: 'NVIDIA GPU',
      vendor: 'nvidia',
      node: 'node2,node3',
      enabled: true,
      disabled_reason: null
    },
    {
      key: 'npu-rngd',
      label: 'Furiosa RNGD NPU (node4)',
      vendor: 'furiosa',
      node: 'node4',
      enabled: true,
      disabled_reason: null
    },
    {
      key: 'npu-rebellions-atomplus',
      label: 'Rebellions Atom+ NPU (node5)',
      vendor: 'rebellions',
      node: 'node5',
      enabled: false,
      disabled_reason: 'node_pending_join'
    }
  ],
  nodes: [
    { name: 'node2', state: 'active', enabled: true, disabled_reason: null },
    { name: 'node3', state: 'active', enabled: true, disabled_reason: null },
    { name: 'node4', state: 'active', enabled: true, disabled_reason: null },
    { name: 'node5', state: 'pending_join', enabled: false, disabled_reason: 'node_pending_join' }
  ],
  models: [
    {
      key: 'llama-3.1-8b-instruct',
      label: 'Llama-3.1-8B-Instruct',
      precisions: ['fp8', 'bf16'],
      enabled: true,
      disabled_reason: null
    }
  ],
  precisions: [
    { key: 'fp8', label: 'FP8', enabled: true, disabled_reason: null },
    { key: 'bf16', label: 'BF16', enabled: true, disabled_reason: null }
  ],
  scenarios: [
    { key: 'offline', label: 'Offline', enabled: true, disabled_reason: null },
    { key: 'server', label: 'Server', enabled: true, disabled_reason: null }
  ],
  batch_sizes: [1, 2, 4, 8],
  concurrencies: [1, 2, 4]
};

const FIXTURE_FEATURE_FLAG_OFF: SweepOptionsResponse = {
  ...FIXTURE_ENABLED,
  enabled: false,
  feature_flag_reason: 'feature_flag_off',
  benchmarks: FIXTURE_ENABLED.benchmarks.map((b) => ({
    ...b,
    enabled: false,
    disabled_reason: 'feature_flag_off'
  })),
  hardware: FIXTURE_ENABLED.hardware.map((h) => ({
    ...h,
    enabled: false,
    disabled_reason:
      h.key === 'npu-rebellions-atomplus' ? 'node_pending_join' : 'feature_flag_off'
  })),
  nodes: FIXTURE_ENABLED.nodes.map((n) => ({
    ...n,
    enabled: false,
    disabled_reason:
      n.name === 'node5' ? 'node_pending_join' : 'feature_flag_off'
  })),
  models: FIXTURE_ENABLED.models.map((m) => ({
    ...m,
    enabled: false,
    disabled_reason: 'feature_flag_off'
  })),
  precisions: FIXTURE_ENABLED.precisions.map((p) => ({
    ...p,
    enabled: false,
    disabled_reason: 'feature_flag_off'
  })),
  scenarios: FIXTURE_ENABLED.scenarios.map((s) => ({
    ...s,
    enabled: false,
    disabled_reason: 'feature_flag_off'
  }))
};

// -----------------------------------------------------------------------
// Suite
// -----------------------------------------------------------------------

describe('SweepControlPage — options grid', () => {
  beforeEach(() => {
    optionsMock.mockReset();
  });

  it('renders the full catalogue when sweep is enabled', async () => {
    optionsMock.mockResolvedValue(FIXTURE_ENABLED);

    render(<SweepControlPage />);

    await waitFor(() => expect(screen.getByTestId('sweep-options-grid')).toBeTruthy());

    // Benchmarks
    expect(screen.getByTestId('flag-mlperf-perf')).toBeTruthy();
    expect(screen.getByTestId('flag-mlperf-acc')).toBeTruthy();
    expect(screen.getByTestId('flag-mmlu-pro')).toBeTruthy();
    expect(screen.getByTestId('flag-tt100')).toBeTruthy();

    // Hardware
    expect(screen.getByTestId('flag-gpu-nvidia')).toBeTruthy();
    expect(screen.getByTestId('flag-npu-rngd')).toBeTruthy();
    expect(screen.getByTestId('flag-npu-rebellions-atomplus')).toBeTruthy();

    // Nodes (chips)
    expect(screen.getByTestId('node-node2')).toBeTruthy();
    expect(screen.getByTestId('node-node5')).toBeTruthy();
    const node5 = screen.getByTestId('node-node5');
    expect(node5.getAttribute('data-state')).toBe('pending_join');

    // Atom+ disabled with node_pending_join reason
    const atom = screen.getByTestId('flag-npu-rebellions-atomplus');
    expect(atom.getAttribute('data-disabled')).toBe('true');
    expect(atom.getAttribute('data-disabled-reason')).toBe('node_pending_join');
    expect(screen.getByTestId('reason-npu-rebellions-atomplus')).toBeTruthy();

    // RNGD enabled (Furiosa, node4)
    const rngd = screen.getByTestId('flag-npu-rngd');
    expect(rngd.getAttribute('data-disabled')).toBe('false');

    // Models / precisions / scenarios
    expect(screen.getByTestId('model-llama-3.1-8b-instruct')).toBeTruthy();
    expect(screen.getByTestId('flag-fp8')).toBeTruthy();
    expect(screen.getByTestId('flag-bf16')).toBeTruthy();
    expect(screen.getByTestId('flag-offline')).toBeTruthy();
    expect(screen.getByTestId('flag-server')).toBeTruthy();

    // Batch sizes & concurrencies (number checkboxes)
    expect(screen.getByTestId('num-batchSizes-1')).toBeTruthy();
    expect(screen.getByTestId('num-batchSizes-8')).toBeTruthy();
    expect(screen.getByTestId('num-concurrencies-1')).toBeTruthy();
    expect(screen.getByTestId('num-concurrencies-4')).toBeTruthy();
  });

  it('renders every option (never blank) when feature flag is off', async () => {
    optionsMock.mockResolvedValue(FIXTURE_FEATURE_FLAG_OFF);

    render(<SweepControlPage />);

    await waitFor(() => expect(screen.getByTestId('sweep-options-grid')).toBeTruthy());

    // Banner present
    expect(screen.getByTestId('feature-flag-banner')).toBeTruthy();

    // Every option still rendered
    expect(screen.getByTestId('flag-mlperf-perf')).toBeTruthy();
    expect(screen.getByTestId('flag-gpu-nvidia')).toBeTruthy();
    expect(screen.getByTestId('flag-npu-rngd')).toBeTruthy();
    expect(screen.getByTestId('flag-npu-rebellions-atomplus')).toBeTruthy();

    // All benchmarks disabled with feature_flag_off
    const mlperf = screen.getByTestId('flag-mlperf-perf');
    expect(mlperf.getAttribute('data-disabled')).toBe('true');
    expect(mlperf.getAttribute('data-disabled-reason')).toBe('feature_flag_off');

    // node5 still pending_join (not silently masked by feature_flag_off)
    const node5 = screen.getByTestId('node-node5');
    expect(node5.getAttribute('data-state')).toBe('pending_join');

    // GPU labelled feature_flag_off
    const gpu = screen.getByTestId('flag-gpu-nvidia');
    expect(gpu.getAttribute('data-disabled-reason')).toBe('feature_flag_off');

    // Atom+ keeps its more-specific node_pending_join reason
    const atom = screen.getByTestId('flag-npu-rebellions-atomplus');
    expect(atom.getAttribute('data-disabled-reason')).toBe('node_pending_join');
  });

  it('falls back to a populated catalogue when /options fails', async () => {
    optionsMock.mockRejectedValue(new Error('boom'));

    render(<SweepControlPage />);

    await waitFor(() => expect(screen.getByTestId('options-load-error')).toBeTruthy());

    // Fallback still renders every category — never blank
    expect(screen.getByTestId('sweep-options-grid')).toBeTruthy();
    expect(screen.getByTestId('flag-mlperf-perf')).toBeTruthy();
    expect(screen.getByTestId('flag-gpu-nvidia')).toBeTruthy();
    expect(screen.getByTestId('flag-npu-rngd')).toBeTruthy();
    expect(screen.getByTestId('flag-npu-rebellions-atomplus')).toBeTruthy();
    expect(screen.getByTestId('node-node5')).toBeTruthy();
    expect(screen.getByTestId('model-llama-3.1-8b-instruct')).toBeTruthy();
  });
});
