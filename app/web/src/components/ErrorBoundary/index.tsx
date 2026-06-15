import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Alert, AlertTitle, Box, Button, Typography } from '@mui/material';

// ----------------------------------------------------------------------

type Props = {
  children: ReactNode;
  /** Called when the user clicks Retry — intended for query.refetch(). */
  onRetry?: () => void;
};

type State = {
  hasError: boolean;
  /** Short, user-quotable reference id for the most recent caught error. */
  errorId: string | null;
};

// ----------------------------------------------------------------------

/**
 * Generate a short (8-char) error reference id, e.g. "E-3F9A2C10". Stable
 * within a single caught error so the value shown to the user matches the
 * value written to the console. Crypto-free so it works in every browser /
 * test environment.
 */
function makeErrorId(): string {
  const rand = Math.random().toString(36).slice(2, 6);
  const time = Date.now().toString(36).slice(-4);
  return `E-${(time + rand).toUpperCase()}`;
}

// ----------------------------------------------------------------------

/**
 * RenderErrorBoundary — wraps a subtree to catch render/state errors that
 * React Query's own error-handling cannot intercept (e.g. crashes in header,
 * drawer, or dialog components). Falls back to an MUI Alert with a short error
 * id and a Retry button that resets the boundary and optionally calls the
 * caller's refetch.
 *
 * USAGE: wrap the WHOLE page body (the entire returned JSX), not just an inner
 * Box — a crash in a header/toolbar rendered outside the boundary would
 * otherwise escape the fallback and corrupt nav state. The three
 * device-comparison pages (mlperf / mmlu / npu `device-comparison/index.tsx`)
 * should move <RenderErrorBoundary> to enclose their full return, including the
 * dashboard header.
 *
 * Theme-aware: uses MUI semantic color tokens only (no hardcoded hex), so it
 * renders correctly in both light and dark mode.
 */
export class RenderErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorId: null };
  }

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true, errorId: makeErrorId() };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface to the console with the same id shown in the UI so a user report
    // ("error E-XXXX") can be matched to this stack trace by monitoring tools.
    const id = this.state.errorId ?? '(unknown)';
    console.error(`[RenderErrorBoundary] ${id} caught render error:`, error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, errorId: null });
    this.props.onRetry?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <Box sx={{ p: 3 }}>
          <Alert
            severity="error"
            action={
              <Button color="inherit" size="small" onClick={this.handleRetry}>
                Retry
              </Button>
            }
          >
            <AlertTitle>This page hit an error</AlertTitle>
            Try refreshing. If it keeps happening, quote this reference:{' '}
            <Typography
              component="span"
              sx={{ fontFamily: 'monospace', fontWeight: 700 }}
            >
              {this.state.errorId}
            </Typography>
          </Alert>
        </Box>
      );
    }
    return this.props.children;
  }
}

export default RenderErrorBoundary;
