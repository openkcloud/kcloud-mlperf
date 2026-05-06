import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ComparisonCandidatePicker } from '@/components/ComparisonCandidatePicker';
import type { ComparisonCandidate } from '@/api/domains/comparison';

// ----------------------------------------------------------------------
// Mock CandidatesApi

const mockGetCandidates = vi.fn();

vi.mock('@/api/domains/comparison', async () => {
  const actual = await vi.importActual<typeof import('@/api/domains/comparison')>(
    '@/api/domains/comparison'
  );
  return {
    ...actual,
    CandidatesApi: {
      getCandidates: (...args: unknown[]) => mockGetCandidates(...args)
    }
  };
});

// Stub Tt100tBadge so tests don't need MUI theme wiring for it
vi.mock('@/components/Tt100tBadge', () => ({
  Tt100tBadge: ({ value }: { value: number | null | undefined }) => (
    <span data-testid="tt100t-badge">{value != null ? `${value}s` : '—'}</span>
  )
}));

// ----------------------------------------------------------------------

const makeCandidate = (overrides: Partial<ComparisonCandidate> = {}): ComparisonCandidate => ({
  category: 'strict',
  comparability_reason: 'Same model, same benchmark',
  run: {
    id: 42,
    benchmark: 'mlperf',
    name: 'RNGD-run-1',
    model: 'Llama-3.1-8B-Instruct',
    hardware: { type: 'npu', vendor: 'furiosa', model: 'RNGD' },
    status: 'completed',
    started_at: null,
    completed_at: '2026-04-28T00:00:00Z',
    metrics: { tt100t_seconds: 0.95, tps: 120.5, accuracy_pct: 78.3, throughput: null },
    artifacts: []
  },
  ...overrides
});

const renderWithClient = (node: ReactNode) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
};

// ----------------------------------------------------------------------

describe('ComparisonCandidatePicker', () => {
  beforeEach(() => {
    mockGetCandidates.mockReset();
  });

  it('shows candidates after runId selection and fetches from API', async () => {
    mockGetCandidates.mockResolvedValue({
      candidates: [makeCandidate()]
    });

    renderWithClient(
      <ComparisonCandidatePicker runId={1} benchmark="mlperf" onSelect={() => {}} />
    );

    await waitFor(() => {
      expect(screen.getByText(/RNGD-run-1/)).toBeInTheDocument();
    });

    expect(mockGetCandidates).toHaveBeenCalledWith(1, { benchmark: 'mlperf' });
  });

  it('shows diagnostic when candidate list is empty', async () => {
    mockGetCandidates.mockResolvedValue({ candidates: [] });

    renderWithClient(
      <ComparisonCandidatePicker runId={5} benchmark="mlperf" onSelect={() => {}} />
    );

    await waitFor(() => {
      expect(
        screen.getByText(/No comparable runs — try changing filter or running a sibling benchmark/i)
      ).toBeInTheDocument();
    });
  });

  it('calls onSelect when a candidate card is clicked', async () => {
    const candidate = makeCandidate();
    mockGetCandidates.mockResolvedValue({ candidates: [candidate] });

    const handleSelect = vi.fn();
    renderWithClient(
      <ComparisonCandidatePicker runId={1} benchmark="mlperf" onSelect={handleSelect} />
    );

    await waitFor(() => screen.getByText(/RNGD-run-1/));
    fireEvent.click(screen.getByText(/RNGD-run-1/));

    expect(handleSelect).toHaveBeenCalledWith(candidate);
  });

  it('renders Strict / Hardware-Optimized / Related sections in order', async () => {
    mockGetCandidates.mockResolvedValue({
      candidates: [
        makeCandidate({ category: 'related', run: { ...makeCandidate().run, id: 10, name: 'Related-run' } }),
        makeCandidate({ category: 'hardware_optimized', run: { ...makeCandidate().run, id: 11, name: 'HWOpt-run' } }),
        makeCandidate({ category: 'strict', run: { ...makeCandidate().run, id: 12, name: 'Strict-run' } })
      ]
    });

    renderWithClient(
      <ComparisonCandidatePicker runId={1} benchmark="mlperf" onSelect={() => {}} />
    );

    await waitFor(() => screen.getByText(/Strict-run/));

    const headings = screen.getAllByRole('heading', { hidden: true }).map((h) => h.textContent);
    const strictIdx = headings.findIndex((h) => h?.includes('Strict'));
    const hwOptIdx = headings.findIndex((h) => h?.includes('Hardware-Optimized'));
    const relatedIdx = headings.findIndex((h) => h?.includes('Related'));

    expect(strictIdx).toBeLessThan(hwOptIdx);
    expect(hwOptIdx).toBeLessThan(relatedIdx);
  });

  it('shows ingestion_failed diagnostic on API error', async () => {
    mockGetCandidates.mockRejectedValue(new Error('network error'));

    renderWithClient(
      <ComparisonCandidatePicker runId={99} onSelect={() => {}} />
    );

    await waitFor(() => {
      expect(screen.getByText(/Failed to load candidate runs/i)).toBeInTheDocument();
    });
  });

  it('renders Tt100tBadge for each candidate', async () => {
    mockGetCandidates.mockResolvedValue({
      candidates: [makeCandidate(), makeCandidate({ run: { ...makeCandidate().run, id: 43, name: 'run-2' } })]
    });

    renderWithClient(
      <ComparisonCandidatePicker runId={1} onSelect={() => {}} />
    );

    await waitFor(() => screen.getByText(/RNGD-run-1/));
    expect(screen.getAllByTestId('tt100t-badge').length).toBe(2);
  });
});
