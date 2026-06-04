import { Component, type ReactNode } from 'react';
import { Alert, Box, Button } from '@mui/material';

// ----------------------------------------------------------------------

type Props = {
  children: ReactNode;
  /** Called when the user clicks Retry — intended for query.refetch(). */
  onRetry?: () => void;
};

type State = {
  hasError: boolean;
};

// ----------------------------------------------------------------------

/**
 * RenderErrorBoundary — wraps a subtree to catch render/state errors that
 * React Query's own error-handling cannot intercept (e.g. crashes in header,
 * drawer, or dialog components). Falls back to an MUI Alert with a Retry
 * button that resets the boundary and optionally calls the caller's refetch.
 *
 * Theme-aware: uses MUI semantic color tokens only (no hardcoded hex).
 */
export class RenderErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Surface to the console so monitoring tools can pick it up.
    console.error('[RenderErrorBoundary] Caught render error:', error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false });
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
            This page hit an error. Try refreshing.
          </Alert>
        </Box>
      );
    }
    return this.props.children;
  }
}
