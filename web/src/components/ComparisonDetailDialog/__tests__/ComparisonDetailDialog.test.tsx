import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ComparisonDetailDialog } from '@/components/ComparisonDetailDialog';
import type { ComparisonRunRow } from '@/api/domains/comparison';

// ----------------------------------------------------------------------

vi.mock('@/components/Tt100tBadge', () => ({
  Tt100tBadge: ({ value }: { value: number | null | undefined }) => (
    <span data-testid="tt100t-badge">{value != null ? `${value}s` : '—'}</span>
  )
}));

// ----------------------------------------------------------------------

const makeRun = (overrides: Partial<ComparisonRunRow> = {}): ComparisonRunRow => ({
  id: 1,
  benchmark: 'mlperf',
  name: 'Test-Run-A',
  model: 'Llama-3.1-8B-Instruct',
  hardware: { type: 'gpu', vendor: 'nvidia', model: 'L40' },
  status: 'completed',
  started_at: '2026-04-01T10:00:00Z',
  completed_at: '2026-04-01T11:00:00Z',
  metrics: { tt100t_seconds: 0.9, tps: 120, accuracy_pct: null, throughput: null },
  artifacts: [],
  ...overrides
});

const runA = makeRun({ id: 1, name: 'Run-A' });
const runB = makeRun({ id: 2, name: 'Run-B', hardware: { type: 'npu', vendor: 'furiosa', model: 'RNGD' } });

const defaultMetrics: Record<string, { a: number | null; b: number | null }> = {
  tt100t_seconds: { a: 0.9, b: 1.05 },
  tps: { a: 120, b: 95 },
  accuracy_pct: { a: null, b: null },
};

// ----------------------------------------------------------------------

describe('ComparisonDetailDialog', () => {
  it('renders dialog with title when open', () => {
    render(
      <ComparisonDetailDialog
        open
        onClose={() => {}}
        title="MLPerf Comparison"
        runA={runA}
        runB={runB}
        metrics={defaultMetrics}
      />
    );
    expect(screen.getByText('MLPerf Comparison')).toBeInTheDocument();
  });

  it('does not render content when closed', () => {
    render(
      <ComparisonDetailDialog
        open={false}
        onClose={() => {}}
        title="Hidden Dialog"
        runA={runA}
        runB={runB}
        metrics={defaultMetrics}
      />
    );
    expect(screen.queryByText('Hidden Dialog')).not.toBeInTheDocument();
  });

  it('shows run headers for both runs', () => {
    render(
      <ComparisonDetailDialog
        open
        onClose={() => {}}
        title="Test"
        runA={runA}
        runB={runB}
        metrics={defaultMetrics}
        labelA="Run A"
        labelB="Run B"
      />
    );
    expect(screen.getByText(/Run-A/)).toBeInTheDocument();
    expect(screen.getByText(/Run-B/)).toBeInTheDocument();
  });

  it('renders metrics table with delta column', () => {
    render(
      <ComparisonDetailDialog
        open
        onClose={() => {}}
        title="Test"
        runA={runA}
        runB={runB}
        metrics={defaultMetrics}
      />
    );
    expect(screen.getByTestId('metrics-table')).toBeInTheDocument();
    expect(screen.getByText('tt100t_seconds')).toBeInTheDocument();
    expect(screen.getByText('Delta (B − A)')).toBeInTheDocument();
  });

  it('shows loading spinner when isLoading is true', () => {
    render(
      <ComparisonDetailDialog
        open
        onClose={() => {}}
        title="Test"
        runA={runA}
        runB={runB}
        metrics={null}
        isLoading
      />
    );
    expect(screen.getByTestId('compare-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('metrics-table')).not.toBeInTheDocument();
  });

  it('shows error alert with retry button when error is set', () => {
    const handleRetry = vi.fn();
    render(
      <ComparisonDetailDialog
        open
        onClose={() => {}}
        title="Test"
        runA={runA}
        runB={runB}
        metrics={null}
        error="Network failure"
        onRetry={handleRetry}
      />
    );
    expect(screen.getByTestId('compare-error')).toBeInTheDocument();
    expect(screen.getByText('Network failure')).toBeInTheDocument();
    const retryBtn = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retryBtn);
    expect(handleRetry).toHaveBeenCalledOnce();
  });

  it('shows incompatible alert and hides metrics table when incompatibleReason is set', () => {
    render(
      <ComparisonDetailDialog
        open
        onClose={() => {}}
        title="Test"
        runA={runA}
        runB={runB}
        metrics={defaultMetrics}
        incompatibleReason="different_model"
      />
    );
    expect(screen.getByTestId('incompatible-alert')).toBeInTheDocument();
    expect(screen.getByText(/Different model/)).toBeInTheDocument();
    expect(screen.queryByTestId('metrics-table')).not.toBeInTheDocument();
  });

  it('uses freeform incompatible reason string when key not in map', () => {
    render(
      <ComparisonDetailDialog
        open
        onClose={() => {}}
        title="Test"
        runA={runA}
        runB={runB}
        metrics={defaultMetrics}
        incompatibleReason="custom incompatibility reason"
      />
    );
    expect(screen.getByText('custom incompatibility reason')).toBeInTheDocument();
  });

  it('shows no-metrics alert when metrics object is empty', () => {
    render(
      <ComparisonDetailDialog
        open
        onClose={() => {}}
        title="Test"
        runA={runA}
        runB={runB}
        metrics={{}}
      />
    );
    expect(screen.getByTestId('no-metrics-alert')).toBeInTheDocument();
  });

  it('calls onClose when Close button is clicked', () => {
    const handleClose = vi.fn();
    render(
      <ComparisonDetailDialog
        open
        onClose={handleClose}
        title="Test"
        runA={runA}
        runB={runB}
        metrics={defaultMetrics}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(handleClose).toHaveBeenCalledOnce();
  });

  it('shows TT100T badges in run headers', () => {
    render(
      <ComparisonDetailDialog
        open
        onClose={() => {}}
        title="Test"
        runA={runA}
        runB={makeRun({ id: 2, metrics: { tt100t_seconds: 1.2, tps: null, accuracy_pct: null, throughput: null } })}
        metrics={defaultMetrics}
      />
    );
    const badges = screen.getAllByTestId('tt100t-badge');
    expect(badges.length).toBeGreaterThanOrEqual(1);
    expect(badges[0].textContent).toContain('0.9s');
  });

  it('shows drift chip when run has drift_flag', () => {
    render(
      <ComparisonDetailDialog
        open
        onClose={() => {}}
        title="Test"
        runA={makeRun({ drift_flag: true, drift_fields: ['precision', 'max_tokens'] })}
        runB={runB}
        metrics={defaultMetrics}
      />
    );
    expect(screen.getByText('config drift')).toBeInTheDocument();
  });

  it('shows positive delta (B > A) and negative delta (B < A) in the table', () => {
    render(
      <ComparisonDetailDialog
        open
        onClose={() => {}}
        title="Test"
        runA={runA}
        runB={runB}
        metrics={{ latency: { a: 1.0, b: 1.5 }, tps: { a: 100, b: 80 } }}
      />
    );
    // latency: B(1.5) - A(1.0) = +0.500 (+50.0%)
    expect(screen.getByText(/\+0\.500/)).toBeInTheDocument();
    // tps: B(80) - A(100) = -20.000 (-20.0%)
    expect(screen.getByText(/-20\.000/)).toBeInTheDocument();
  });
});
