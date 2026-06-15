import { type PaletteOptions, type PaletteMode } from '@mui/material';

// Shared brand + grey scale (mode-independent).
const brand = {
  primary: { main: '#4F46E5', light: '#818CF8', dark: '#3730A3', contrastText: '#FFFFFF' },
  secondary: { main: '#0EA5E9', light: '#38BDF8', dark: '#0284C7', contrastText: '#FFFFFF' },
  error: { main: '#EF4444', light: '#FCA5A5' },
  warning: { main: '#F59E0B', light: '#FDE68A' },
  success: { main: '#10B981', light: '#6EE7B7' },
  info: { main: '#6366F1', light: '#A5B4FC' },
  grey: {
    50: '#F8FAFC', 100: '#F1F5F9', 200: '#E2E8F0', 300: '#CBD5E1', 400: '#94A3B8',
    500: '#64748B', 600: '#475569', 700: '#334155', 800: '#1E293B', 900: '#0F172A',
  },
};

export const getPalette = (mode: PaletteMode): PaletteOptions =>
  mode === 'dark'
    ? {
        mode: 'dark',
        ...brand,
        background: { paper: '#1E293B', default: '#0F172A' },
        text: { primary: '#E2E8F0', secondary: '#94A3B8', disabled: '#64748B' },
        divider: 'rgba(148,163,184,0.18)',
      }
    : {
        mode: 'light',
        ...brand,
        background: { paper: '#FFFFFF', default: '#F8FAFC' },
        text: { primary: '#0F172A', secondary: '#475569', disabled: '#94A3B8' },
        divider: '#E2E8F0',
      };

// Backward-compatible default (light) export.
export const palette: PaletteOptions = getPalette('light');
