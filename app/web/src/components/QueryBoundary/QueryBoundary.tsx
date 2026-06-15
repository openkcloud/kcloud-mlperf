import { type ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';

import { Alert, Box, Button, CircularProgress, Typography } from '@mui/material';

// ----------------------------------------------------------------------

type QueryBoundaryProps<T> = {
  query: UseQueryResult<T, Error>;
  children: ReactNode;
  /** Override empty-state detection. Default: data is undefined OR (Array && length === 0). */
  isEmpty?: (data: T) => boolean;
};

function defaultIsEmpty<T>(data: T): boolean {
  if (data === undefined || data === null) return true;
  if (Array.isArray(data) && data.length === 0) return true;
  return false;
}

// ----------------------------------------------------------------------

const Loading = () => (
  <Box
    sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 6 }}
    data-testid="query-boundary-loading"
  >
    <CircularProgress size={32} />
  </Box>
);

// ----------------------------------------------------------------------

type ErrorBannerProps = {
  reason: string;
  retry?: () => void;
};

const ErrorBanner = ({ reason, retry }: ErrorBannerProps) => (
  <Alert
    severity="error"
    sx={{ mb: 2 }}
    action={
      retry ? (
        <Button color="inherit" size="small" onClick={retry}>
          Retry
        </Button>
      ) : undefined
    }
    data-testid="query-boundary-error"
  >
    {reason}
  </Alert>
);

// ----------------------------------------------------------------------

const EmptyState = () => (
  <Box
    sx={{ py: 6, textAlign: 'center' }}
    data-testid="query-boundary-empty"
  >
    <Typography variant="body2" color="text.secondary">
      No data available.
    </Typography>
  </Box>
);

// ----------------------------------------------------------------------

export function QueryBoundary<T>({ query, children, isEmpty }: QueryBoundaryProps<T>) {
  const { isLoading, isError, error, data, refetch } = query;

  if (isLoading) {
    return <Loading />;
  }

  if (isError) {
    return (
      <ErrorBanner
        reason={error?.message ?? 'An unexpected error occurred.'}
        retry={refetch}
      />
    );
  }

  const emptyCheck = isEmpty ?? defaultIsEmpty;
  if (data === undefined || emptyCheck(data)) {
    return <EmptyState />;
  }

  return <>{children}</>;
}
