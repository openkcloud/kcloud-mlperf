import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  getGpuPrometheusUrl,
  getL40LiveBenchUrl,
  deriveState,
  PrometheusIframeDashboard,
} from '../PrometheusIframeDashboard';

// ---------------------------------------------------------------------------
// Unit tests for pure helpers
// ---------------------------------------------------------------------------

describe('getGpuPrometheusUrl', () => {
  it('returns empty string when env var is not set', () => {
    expect(getGpuPrometheusUrl()).toBe('');
  });

  it('returns the env var value when set', () => {
    const original = import.meta.env.VITE__APP_GPU_PROMETHEUS_URL;
    (import.meta.env as Record<string, unknown>).VITE__APP_GPU_PROMETHEUS_URL =
      'http://10.254.177.41:30091';
    expect(getGpuPrometheusUrl()).toBe('http://10.254.177.41:30091');
    (import.meta.env as Record<string, unknown>).VITE__APP_GPU_PROMETHEUS_URL = original;
  });
});

describe('getL40LiveBenchUrl', () => {
  it('returns the env var value when set', () => {
    const original = import.meta.env.VITE__APP_L40_LIVE_BENCH_URL;
    (import.meta.env as Record<string, unknown>).VITE__APP_L40_LIVE_BENCH_URL =
      'http://override.example:9999/';
    expect(getL40LiveBenchUrl()).toBe('http://override.example:9999/');
    (import.meta.env as Record<string, unknown>).VITE__APP_L40_LIVE_BENCH_URL = original;
  });

  it('returns the hardcoded node2 fallback when env var is unset', () => {
    const original = import.meta.env.VITE__APP_L40_LIVE_BENCH_URL;
    delete (import.meta.env as Record<string, unknown>).VITE__APP_L40_LIVE_BENCH_URL;
    expect(getL40LiveBenchUrl()).toBe('http://10.254.184.195:30891/');
    (import.meta.env as Record<string, unknown>).VITE__APP_L40_LIVE_BENCH_URL = original;
  });
});

describe('deriveState', () => {
  it('returns unavailable when url is empty', () => {
    expect(deriveState('', false)).toBe('unavailable');
  });

  it('returns unavailable even when loadError is true and url is empty', () => {
    expect(deriveState('', true)).toBe('unavailable');
  });

  it('returns error when url is set and loadError is true', () => {
    expect(deriveState('http://example.com', true)).toBe('error');
  });

  it('returns ready when url is set and no error', () => {
    expect(deriveState('http://example.com', false)).toBe('ready');
  });
});

// ---------------------------------------------------------------------------
// Component rendering tests
// ---------------------------------------------------------------------------

describe('PrometheusIframeDashboard', () => {
  beforeEach(() => {
    (import.meta.env as Record<string, unknown>).VITE__APP_GPU_PROMETHEUS_URL = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders unavailable state when no src and no env var', () => {
    render(<PrometheusIframeDashboard title="Test Dashboard" />);
    expect(screen.getByText('Unavailable')).toBeTruthy();
    expect(screen.queryByRole('iframe' as 'none')).toBeNull();
  });

  it('renders custom fallback message when unavailable', () => {
    render(
      <PrometheusIframeDashboard
        title="GPU Dashboard"
        fallbackMessage="Prometheus URL not configured — set VITE__APP_GPU_PROMETHEUS_URL"
      />
    );
    expect(
      screen.getByText('Prometheus URL not configured — set VITE__APP_GPU_PROMETHEUS_URL')
    ).toBeTruthy();
  });

  it('renders default fallback message when unavailable and no custom message', () => {
    render(<PrometheusIframeDashboard title="GPU Dashboard" />);
    expect(
      screen.getByText('Prometheus URL not configured — set VITE__APP_GPU_PROMETHEUS_URL')
    ).toBeTruthy();
  });

  it('renders title correctly', () => {
    render(<PrometheusIframeDashboard title="Live GPU Dashboard" />);
    expect(screen.getByText('Live GPU Dashboard')).toBeTruthy();
  });

  it('renders iframe when src prop is provided', () => {
    const { container } = render(
      <PrometheusIframeDashboard title="Test" src="http://10.254.177.41:30091" />
    );
    const iframe = container.querySelector('iframe');
    expect(iframe).toBeTruthy();
    expect(iframe?.getAttribute('src')).toBe('http://10.254.177.41:30091');
  });

  it('renders iframe when env var is set', () => {
    (import.meta.env as Record<string, unknown>).VITE__APP_GPU_PROMETHEUS_URL =
      'http://10.254.177.41:30091';
    const { container } = render(<PrometheusIframeDashboard title="Test" />);
    const iframe = container.querySelector('iframe');
    expect(iframe).toBeTruthy();
  });

  it('shows open-in-new-tab link when src is provided', () => {
    render(<PrometheusIframeDashboard title="Test" src="http://10.254.177.41:30091" />);
    const link = screen.getByText('open in new tab ↗');
    expect(link).toBeTruthy();
  });

  it('does not show open-in-new-tab link when unavailable', () => {
    render(<PrometheusIframeDashboard title="Test" />);
    expect(screen.queryByText('open in new tab ↗')).toBeNull();
  });
});
