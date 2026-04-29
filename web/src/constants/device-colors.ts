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

export const getVendorColor = (vendor: string | null | undefined): string => {
  if (!vendor) return DEVICE_COLORS.GPU;
  return VENDOR_COLORS[vendor] ?? DEVICE_COLORS.GPU;
};
