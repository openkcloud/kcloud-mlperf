import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode } from 'react';

import { HTTP_CODE_BAD_REQUEST, HTTP_CODE_SERVER_ERROR } from '@/constants/http-code.constants';

// ----------------------------------------------------------------------

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // optimizes re-renders when fetching data
      // refetchOnWindowFocus: import.meta.env.DEV,
      notifyOnChangeProps: ['isLoading', 'data'],
      // To do: check if it is working properly or not
      retry: (failureCount: number, error) => {
        const code = (error as { response?: { code?: number } })?.response?.code;

        if (code === HTTP_CODE_SERVER_ERROR || code === HTTP_CODE_BAD_REQUEST) {
          return false;
        }

        return failureCount < 3;
      }
    }
  }
});

// ----------------------------------------------------------------------

type ReactQueryProviderProps = {
  children: ReactNode;
};

// ----------------------------------------------------------------------

export const ReactQueryProvider = (props: ReactQueryProviderProps) => {
  const { children } = props;

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
};
