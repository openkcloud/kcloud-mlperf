import { CacheProvider } from '@emotion/react';
import { type ReactNode } from 'react';

import { CssBaseline, ThemeProvider as MaterialThemeProvider } from '@mui/material';

import { createEmotionCache } from '@/helpers/create-emotion-cashe.helper';

import { theme } from '@/contexts/ThemeContext/theme';

// ----------------------------------------------------------------------

const clientEmotionCache = createEmotionCache();

// ----------------------------------------------------------------------

type ThemeProviderProps = {
  children: ReactNode;
};

// ----------------------------------------------------------------------

export const ThemeProvider = (props: ThemeProviderProps) => {
  const { children } = props;

  return (
    <CacheProvider value={clientEmotionCache}>
      <MaterialThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </MaterialThemeProvider>
    </CacheProvider>
  );
};
