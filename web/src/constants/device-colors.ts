export const DEVICE_COLORS = {
  NPU: '#F97316',
  GPU: '#4F46E5',
  'NVIDIA-L40': '#4F46E5',
  'NVIDIA-A40': '#7C3AED',
  'NVIDIA-L40-44GiB': '#0284C7',
  'NVIDIA-A40-44GiB': '#0F766E',
} as const;

export type DeviceColorKey = keyof typeof DEVICE_COLORS;

export const getDeviceColor = (key: string): string => {
  if (key in DEVICE_COLORS) return DEVICE_COLORS[key as DeviceColorKey];
  return DEVICE_COLORS.GPU;
};
