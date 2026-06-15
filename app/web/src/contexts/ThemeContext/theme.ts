import { createTheme, type Theme, type PaletteMode } from '@mui/material';

import { getPalette } from '@/contexts/ThemeContext/theme.palette';

// ----------------------------------------------------------------------
// Mode-aware theme factory. Component overrides reference the active palette
// (callback form) so tables/inputs/surfaces adapt to light AND dark instead of
// hardcoding light-only colors.
// ----------------------------------------------------------------------

const SHADOWS = [
  'none',
  '0 1px 2px 0 rgba(0,0,0,0.05)',
  '0 1px 3px 0 rgba(0,0,0,0.1), 0 1px 2px -1px rgba(0,0,0,0.1)',
  '0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1)',
  '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.1)',
  '0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)',
  ...Array(19).fill('0 25px 50px -12px rgba(0,0,0,0.25)'),
] as Theme['shadows'];

export const createAppTheme = (mode: PaletteMode): Theme =>
  createTheme({
    palette: getPalette(mode),
    shape: { borderRadius: '0.625rem' },
    typography: {
      fontFamily: '"Inter Variable", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      h1: { fontWeight: 700, letterSpacing: '-0.025em' },
      h2: { fontWeight: 600, letterSpacing: '-0.025em' },
      h3: { fontWeight: 600, letterSpacing: '-0.02em' },
      subtitle1: { fontWeight: 500 },
      subtitle2: { fontWeight: 500 },
      body1: { lineHeight: 1.6 },
      body2: { lineHeight: 1.5 },
      button: { fontWeight: 600, textTransform: 'none', letterSpacing: '0.01em' },
    },
    shadows: SHADOWS,
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: { backgroundColor: mode === 'dark' ? '#0F172A' : '#F8FAFC' },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: '0.5rem',
            padding: '0.5rem 1.25rem',
            boxShadow: 'none',
            '&:hover': { boxShadow: '0 1px 3px 0 rgba(0,0,0,0.1), 0 1px 2px -1px rgba(0,0,0,0.1)' },
          },
          contained: {
            background: 'linear-gradient(135deg, #4F46E5 0%, #6366F1 100%)',
            '&:hover': { background: 'linear-gradient(135deg, #4338CA 0%, #4F46E5 100%)' },
          },
          outlined: ({ theme }) => ({
            borderColor: theme.palette.divider,
            color: theme.palette.text.secondary,
            '&:hover': {
              borderColor: theme.palette.primary.main,
              backgroundColor: theme.palette.action.hover,
            },
          }),
        },
      },
      MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
      MuiTextField: {
        styleOverrides: {
          root: ({ theme }) => ({
            '& .MuiOutlinedInput-root': {
              backgroundColor: theme.palette.background.paper,
              transition: 'all 0.2s ease',
              '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: theme.palette.primary.light },
              '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: theme.palette.primary.main, borderWidth: '2px' },
            },
            '& .MuiOutlinedInput-notchedOutline': { borderColor: theme.palette.divider },
          }),
        },
      },
      MuiInputLabel: {
        styleOverrides: {
          root: ({ theme }) => ({ color: theme.palette.text.secondary, fontWeight: 500, fontSize: '0.875rem' }),
        },
      },
      MuiTableHead: {
        styleOverrides: {
          root: ({ theme }) => ({
            '& .MuiTableCell-head': {
              fontWeight: 600,
              color: theme.palette.text.primary,
              backgroundColor: theme.palette.mode === 'dark' ? '#172033' : '#F1F5F9',
              borderBottom: `2px solid ${theme.palette.divider}`,
              fontSize: '0.8125rem',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            },
          }),
        },
      },
      MuiTableBody: {
        styleOverrides: {
          root: ({ theme }) => ({
            '& .MuiTableRow-root': {
              transition: 'background-color 0.15s ease',
              '&:hover': { backgroundColor: theme.palette.action.hover },
            },
            '& .MuiTableCell-root': {
              borderBottom: `1px solid ${theme.palette.divider}`,
              color: theme.palette.text.secondary,
              fontSize: '0.875rem',
            },
          }),
        },
      },
      MuiAutocomplete: {
        styleOverrides: {
          paper: ({ theme }) => ({
            boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.1)',
            border: `1px solid ${theme.palette.divider}`,
            borderRadius: '0.5rem',
          }),
        },
      },
      MuiChip: { styleOverrides: { root: { fontWeight: 500, borderRadius: '0.375rem' } } },
      MuiAccordion: {
        styleOverrides: { root: { '&::before': { display: 'none' }, borderRadius: '0.75rem !important' } },
      },
      MuiAccordionSummary: {
        styleOverrides: {
          root: { borderRadius: '0.75rem', '&.Mui-expanded': { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 } },
        },
      },
    },
  });

// Backward-compatible default (light) export.
export const theme = createAppTheme('light');
