/**
 * QueryBoundary integration tests for US-NEXT-7 wrapped pages.
 *
 * Each test mounts the page component with a mocked query returning
 * { isLoading: true } and asserts the Loading spinner is rendered.
 */
import type { UseQueryResult } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { ThemeProvider, createTheme } from '@mui/material';
import { describe, expect, it, vi } from 'vitest';

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------

function makeQuery<T>(overrides: Partial<UseQueryResult<T, Error>> = {}): UseQueryResult<T, Error> {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    isError: false,
    isPending: false,
    isSuccess: false,
    isFetching: false,
    isFetchedAfterMount: false,
    isFetched: false,
    isRefetching: false,
    isLoadingError: false,
    isRefetchError: false,
    isPlaceholderData: false,
    isStale: false,
    isInitialLoading: false,
    dataUpdatedAt: 0,
    errorUpdatedAt: 0,
    failureCount: 0,
    failureReason: null,
    fetchStatus: 'idle',
    status: 'pending',
    errorUpdateCount: 0,
    refetch: vi.fn(),
    promise: Promise.resolve(undefined as T),
    ...overrides
  } as unknown as UseQueryResult<T, Error>;
}

const loadingQuery = makeQuery({ isLoading: true, isPending: true, fetchStatus: 'fetching' });

const theme = createTheme();

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <MemoryRouter>
      <ThemeProvider theme={theme}>{children}</ThemeProvider>
    </MemoryRouter>
  );
}

// ----------------------------------------------------------------------
// Mock @tanstack/react-query so pages get our controlled query objects
// ----------------------------------------------------------------------

// We mock useQuery at the module level so all pages use our stubs.
vi.mock('@tanstack/react-query', async importOriginal => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQuery: vi.fn().mockReturnValue(loadingQuery),
    useMutation: vi.fn().mockReturnValue({
      mutate: vi.fn(),
      isPending: false
    }),
    useQueryClient: vi.fn().mockReturnValue({ invalidateQueries: vi.fn() })
  };
});

// Mock react-hook-form used in pages with forms
vi.mock('react-hook-form', async importOriginal => {
  const actual = await importOriginal<typeof import('react-hook-form')>();
  return {
    ...actual,
    useForm: vi.fn().mockReturnValue({
      control: {},
      handleSubmit: vi.fn(fn => (e?: Event) => {
        e?.preventDefault?.();
        fn({});
      }),
      reset: vi.fn(),
      watch: vi.fn().mockReturnValue('mlperf'),
      setValue: vi.fn()
    }),
    Controller: vi.fn(({ render: renderProp }) =>
      renderProp({
        field: { value: '', onChange: vi.fn(), onBlur: vi.fn(), name: '', ref: vi.fn() },
        fieldState: { invalid: false, isTouched: false, isDirty: false, error: undefined },
        formState: { errors: {} } as any
      })
    )
  };
});

// Mock useStore (Zustand) used by some pages
vi.mock('@/store', () => ({
  useStore: vi.fn().mockReturnValue({ testComparison: { mpExamIds: [] } })
}));

// Mock useRealtimeExams used by rngd page
vi.mock('@/hooks/useRealtimeExams', () => ({
  useRealtimeExams: vi.fn().mockReturnValue({ snapshot: null })
}));

// ----------------------------------------------------------------------
// Tests: 1 — NPU device comparison (npu/device-comparison)
// ----------------------------------------------------------------------

describe('NpuDeviceComparisonPage — QueryBoundary', () => {
  it('renders loading spinner when list query is loading', async () => {
    const { default: NpuDeviceComparisonPage } = await import(
      '@/pages/npu/device-comparison/index'
    );
    render(
      <Wrapper>
        <NpuDeviceComparisonPage />
      </Wrapper>
    );
    expect(screen.getByTestId('query-boundary-loading')).toBeInTheDocument();
  });
});

// ----------------------------------------------------------------------
// Tests: 2 — RNGD device comparison (npu-eval/rngd/device-comparison)
// ----------------------------------------------------------------------

describe('RngdDeviceComparisonPage — QueryBoundary', () => {
  it('renders loading spinner when list query is loading', async () => {
    const { default: RngdDeviceComparisonPage } = await import(
      '@/pages/npu-eval/rngd/device-comparison/index'
    );
    render(
      <Wrapper>
        <RngdDeviceComparisonPage />
      </Wrapper>
    );
    expect(screen.getByTestId('query-boundary-loading')).toBeInTheDocument();
  });
});

// ----------------------------------------------------------------------
// Tests: 3 — AtomPlus device comparison (npu-eval/atomplus/device-comparison)
// ----------------------------------------------------------------------

describe('AtomPlusDeviceComparisonPage — QueryBoundary', () => {
  it('renders loading spinner when list query is loading', async () => {
    const { default: AtomPlusDeviceComparisonPage } = await import(
      '@/pages/npu-eval/atomplus/device-comparison/index'
    );
    render(
      <Wrapper>
        <AtomPlusDeviceComparisonPage />
      </Wrapper>
    );
    expect(screen.getByTestId('query-boundary-loading')).toBeInTheDocument();
  });
});

// ----------------------------------------------------------------------
// Tests: 4 — RNGD NPU eval main page (npu-eval/rngd)
// ----------------------------------------------------------------------

describe('RngdNpuEvalPage — QueryBoundary', () => {
  it('renders loading spinner when exam list query is loading', async () => {
    const { default: RngdNpuEvalPage } = await import('@/pages/npu-eval/rngd/index');
    render(
      <Wrapper>
        <RngdNpuEvalPage />
      </Wrapper>
    );
    expect(screen.getByTestId('query-boundary-loading')).toBeInTheDocument();
  });
});

// ----------------------------------------------------------------------
// Tests: 5 — NPU main page (npu/main)
// ----------------------------------------------------------------------

describe('NpuEvalPage — QueryBoundary', () => {
  it('renders loading spinner when exam list query is loading', async () => {
    const { default: NpuEvalPage } = await import('@/pages/npu/main/index');
    render(
      <Wrapper>
        <NpuEvalPage />
      </Wrapper>
    );
    expect(screen.getByTestId('query-boundary-loading')).toBeInTheDocument();
  });
});

// ----------------------------------------------------------------------
// Tests: 6 — Home page VendorCluster (home/HomePage)
// ----------------------------------------------------------------------

describe('HomePage VendorCluster — QueryBoundary', () => {
  it('renders loading spinner when devices query is loading', async () => {
    const { default: HomePage } = await import('@/pages/home/HomePage');
    render(
      <Wrapper>
        <HomePage />
      </Wrapper>
    );
    // At least one loading spinner should be present (VendorCluster or Tt100tLeaderboard)
    expect(screen.getAllByTestId('query-boundary-loading').length).toBeGreaterThanOrEqual(1);
  });
});
