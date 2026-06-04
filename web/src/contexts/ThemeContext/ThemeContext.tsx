import { CacheProvider } from '@emotion/react';
import { createContext, useContext, useMemo, useState, useCallback, type ReactNode } from 'react';

import { CssBaseline, ThemeProvider as MaterialThemeProvider, type PaletteMode } from '@mui/material';

import { createEmotionCache } from '@/helpers/create-emotion-cashe.helper';
import { createAppTheme } from '@/contexts/ThemeContext/theme';

// ----------------------------------------------------------------------

const clientEmotionCache = createEmotionCache();
const STORAGE_KEY = 'etri-theme-mode';

type ColorModeCtx = { mode: PaletteMode; toggleColorMode: () => void };
const ColorModeContext = createContext<ColorModeCtx>({ mode: 'light', toggleColorMode: () => {} });

/** Read/write the user's preferred theme mode. */
export const useColorMode = (): ColorModeCtx => useContext(ColorModeContext);

const readInitialMode = (): PaletteMode => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* SSR / blocked storage — fall through */
  }
  return 'light';
};

// ----------------------------------------------------------------------

type ThemeProviderProps = { children: ReactNode };

export const ThemeProvider = ({ children }: ThemeProviderProps) => {
  const [mode, setMode] = useState<PaletteMode>(readInitialMode);

  const toggleColorMode = useCallback(() => {
    setMode(prev => {
      const next: PaletteMode = prev === 'light' ? 'dark' : 'light';
      try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const theme = useMemo(() => createAppTheme(mode), [mode]);
  const ctx = useMemo(() => ({ mode, toggleColorMode }), [mode, toggleColorMode]);

  return (
    <ColorModeContext.Provider value={ctx}>
      <CacheProvider value={clientEmotionCache}>
        <MaterialThemeProvider theme={theme}>
          <CssBaseline />
          {children}
        </MaterialThemeProvider>
      </CacheProvider>
    </ColorModeContext.Provider>
  );
};
