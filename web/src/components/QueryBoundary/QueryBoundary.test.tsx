import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { UseQueryResult } from '@tanstack/react-query';

import { QueryBoundary } from './QueryBoundary';

// ----------------------------------------------------------------------

function makeQuery<T>(overrides: Partial<UseQueryResult<T, Error>>): UseQueryResult<T, Error> {
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
    ...overrides,
  } as unknown as UseQueryResult<T, Error>;
}

// ----------------------------------------------------------------------

describe('QueryBoundary', () => {
  it('renders loading spinner when query.isLoading is true', () => {
    const query = makeQuery<string[]>({ isLoading: true, isPending: true, fetchStatus: 'fetching' });
    render(
      <QueryBoundary query={query}>
        <div>content</div>
      </QueryBoundary>
    );
    expect(screen.getByTestId('query-boundary-loading')).toBeInTheDocument();
    expect(screen.queryByText('content')).not.toBeInTheDocument();
  });

  it('renders error banner when query.isError is true', () => {
    const query = makeQuery<string[]>({
      isError: true,
      error: new Error('Network failure'),
      status: 'error',
    });
    render(
      <QueryBoundary query={query}>
        <div>content</div>
      </QueryBoundary>
    );
    expect(screen.getByTestId('query-boundary-error')).toBeInTheDocument();
    expect(screen.getByText('Network failure')).toBeInTheDocument();
    expect(screen.queryByText('content')).not.toBeInTheDocument();
  });

  it('calls refetch when Retry button is clicked on error state', () => {
    const refetch = vi.fn();
    const query = makeQuery<string[]>({
      isError: true,
      error: new Error('Timeout'),
      status: 'error',
      refetch,
    });
    render(
      <QueryBoundary query={query}>
        <div>content</div>
      </QueryBoundary>
    );
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('renders empty state when data is an empty array', () => {
    const query = makeQuery<string[]>({
      data: [],
      isSuccess: true,
      status: 'success',
      isFetched: true,
    });
    render(
      <QueryBoundary query={query}>
        <div>content</div>
      </QueryBoundary>
    );
    expect(screen.getByTestId('query-boundary-empty')).toBeInTheDocument();
    expect(screen.queryByText('content')).not.toBeInTheDocument();
  });

  it('renders empty state when data is undefined', () => {
    const query = makeQuery<string[] | undefined>({
      data: undefined,
      isSuccess: true,
      status: 'success',
      isFetched: true,
    });
    render(
      <QueryBoundary query={query}>
        <div>content</div>
      </QueryBoundary>
    );
    expect(screen.getByTestId('query-boundary-empty')).toBeInTheDocument();
  });

  it('renders children when query has data', () => {
    const query = makeQuery<string[]>({
      data: ['item1', 'item2'],
      isSuccess: true,
      status: 'success',
      isFetched: true,
    });
    render(
      <QueryBoundary query={query}>
        <div>content loaded</div>
      </QueryBoundary>
    );
    expect(screen.getByText('content loaded')).toBeInTheDocument();
    expect(screen.queryByTestId('query-boundary-loading')).not.toBeInTheDocument();
    expect(screen.queryByTestId('query-boundary-error')).not.toBeInTheDocument();
    expect(screen.queryByTestId('query-boundary-empty')).not.toBeInTheDocument();
  });

  it('respects custom isEmpty override', () => {
    const query = makeQuery<{ items: string[] }>({
      data: { items: [] },
      isSuccess: true,
      status: 'success',
      isFetched: true,
    });
    render(
      <QueryBoundary query={query} isEmpty={d => d.items.length === 0}>
        <div>content</div>
      </QueryBoundary>
    );
    expect(screen.getByTestId('query-boundary-empty')).toBeInTheDocument();
  });
});
