// ----------------------------------------------------------------------
// MODELED $/hr (On-Demand) assumptions for the cost-per-1M-tokens view.
//
// IMPORTANT: these are EXTERNAL MODELED ASSUMPTIONS, not measured cluster
// costs. ETRI runs this hardware bare-metal, so there is no real hourly bill;
// these figures are plausible public cloud / list-price proxies used only to
// turn throughput (tok/s) into a comparable $/Mtok efficiency axis. Treat them
// as order-of-magnitude estimates, and clearly labeled as assumptions in the UI.
//
// Sourcing notes (public list / cloud on-demand single-accelerator rates,
// rounded; captured 2026-06, USD/hr per ONE accelerator):
//   A30   — NVIDIA A30 24GB: ~ mid-range Ampere cloud rate (between T4 and A100).
//   L40   — NVIDIA L40 48GB: ~ Ada datacenter GPU on-demand list proxy.
//   A40   — NVIDIA A40 48GB: ~ Ampere datacenter GPU on-demand list proxy.
//   RNGD  — FuriosaAI RNGD: no broad public cloud rate; MODELED at a GPU-class
//           proxy for a single PCIe card (assumption only, not a quoted price).
//   Atom+ — Rebellions Atom+: no broad public cloud rate; MODELED similarly to
//           a mid-range inference accelerator (assumption only).
// ----------------------------------------------------------------------

/** Modeled On-Demand $/hr per single accelerator, keyed by hardware model. */
export const DEVICE_USD_PER_HR: Record<string, number> = {
  A30: 0.9, // NVIDIA A30 24GB — mid-range Ampere proxy (assumption)
  L40: 1.4, // NVIDIA L40 48GB — Ada datacenter proxy (assumption)
  A40: 1.2, // NVIDIA A40 48GB — Ampere datacenter proxy (assumption)
  RNGD: 1.1, // FuriosaAI RNGD — GPU-class single-card proxy (assumption)
  'Atom+': 0.8, // Rebellions Atom+ — inference accelerator proxy (assumption)
};

/**
 * Resolve the modeled $/hr for a hardware model string. Robust to the SKU
 * variants the data carries (e.g. 'NVIDIA-L40', 'REBELLIONS-Atom+', 'FURIOSA-RNGD')
 * by falling back to a substring heuristic, mirroring `getDeviceColor`. Returns
 * `null` when no assumption applies (so the UI can render '—' rather than a guess).
 */
export function deviceUsdPerHr(hwModel: string | null | undefined): number | null {
  if (!hwModel) return null;
  // Exact match first (canonical keys: 'A30', 'L40', 'A40', 'RNGD', 'Atom+').
  if (hwModel in DEVICE_USD_PER_HR) return DEVICE_USD_PER_HR[hwModel];
  const upper = hwModel.toUpperCase();
  if (upper.includes('RNGD') || upper.includes('FURIOSA')) return DEVICE_USD_PER_HR.RNGD;
  if (upper.includes('ATOM') || upper.includes('REBELLIONS')) return DEVICE_USD_PER_HR['Atom+'];
  if (upper.includes('L40')) return DEVICE_USD_PER_HR.L40;
  if (upper.includes('A40')) return DEVICE_USD_PER_HR.A40;
  if (upper.includes('A30')) return DEVICE_USD_PER_HR.A30;
  return null;
}
