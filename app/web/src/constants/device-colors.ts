export const DEVICE_COLORS = {
  NPU: '#F97316',
  GPU: '#4F46E5',
  // NVIDIA SKU palette
  'NVIDIA-L40': '#4F46E5',
  'NVIDIA-A40': '#7C3AED',
  'NVIDIA-L40-44GiB': '#0284C7',
  'NVIDIA-A40-44GiB': '#0F766E',
  // Furiosa RNGD — teal
  'FURIOSA-RNGD': '#14B8A6',
  RNGD: '#14B8A6',
  // Rebellions Atom+ — purple. Slot key is 'REBELLIONS-Atom+' (mixed case
  // preserved to match server slotKeyFromDevice output).
  'REBELLIONS-Atom+': '#A855F7',
  'REBELLIONS-ATOM-PLUS': '#A855F7',
  'ATOM+': '#A855F7',
  'ATOM-PLUS': '#A855F7'
} as const;

export type DeviceColorKey = keyof typeof DEVICE_COLORS;

export const VENDOR_COLORS: Record<string, string> = {
  NVIDIA: '#4F46E5',
  nvidia: '#4F46E5',
  Furiosa: '#14B8A6',
  FuriosaAI: '#14B8A6',
  furiosa: '#14B8A6',
  Rebellions: '#A855F7',
  rebellions: '#A855F7',
  Intel: '#0284C7',
  intel: '#0284C7'
};

// Dark-surface-safe variants chosen for >=4.5:1 contrast on #0F172A/#1E293B.
// NVIDIA indigo #4F46E5 → 3.1:1 on dark bg; lightened to #818CF8 (6.0:1).
// Furiosa teal #14B8A6 → 2.9:1; lightened to #2DD4BF (5.1:1).
// Rebellions purple #A855F7 → 4.7:1 (already passes, kept slightly lighter).
// Intel blue #0284C7 → 3.3:1; lightened to #38BDF8 (6.6:1).
export const VENDOR_COLORS_DARK: Record<string, string> = {
  NVIDIA: '#818CF8',    // indigo-400  ~6.0:1 on #0F172A
  nvidia: '#818CF8',
  Furiosa: '#2DD4BF',  // teal-400    ~5.1:1 on #0F172A
  FuriosaAI: '#2DD4BF',
  furiosa: '#2DD4BF',
  Rebellions: '#C084FC', // purple-400  ~6.2:1 on #0F172A
  rebellions: '#C084FC',
  Intel: '#38BDF8',    // sky-400     ~6.6:1 on #0F172A
  intel: '#38BDF8'
};

export const getDeviceColor = (key: string): string => {
  if (key in DEVICE_COLORS) return DEVICE_COLORS[key as DeviceColorKey];
  // Heuristic fallbacks by substring
  const upper = key.toUpperCase();
  if (upper.includes('RNGD') || upper.includes('FURIOSA')) return DEVICE_COLORS['FURIOSA-RNGD'];
  if (upper.includes('ATOM') || upper.includes('REBELLIONS'))
    return DEVICE_COLORS['REBELLIONS-Atom+'];
  if (upper.includes('NVIDIA') || upper.includes('GPU')) return DEVICE_COLORS.GPU;
  if (upper.includes('NPU')) return DEVICE_COLORS.NPU;
  return DEVICE_COLORS.GPU;
};

export const getVendorColor = (
  vendor: string | null | undefined,
  mode: 'light' | 'dark' = 'light',
): string => {
  if (!vendor) return mode === 'dark' ? '#818CF8' : DEVICE_COLORS.GPU;
  const map = mode === 'dark' ? VENDOR_COLORS_DARK : VENDOR_COLORS;
  return map[vendor] ?? (mode === 'dark' ? '#818CF8' : DEVICE_COLORS.GPU);
};
