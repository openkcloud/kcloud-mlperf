# RNGD Dashboard Structural Contract

**Version:** 1.0  
**Date:** 2026-05-06  
**Authority:** Worker-2 (benchsuite-redo team)  
**Consumers:** W3 (GPU realtime dashboard), W4 (Atom+ dashboard), W14 (UI critic)

This document is the exact structural contract that W3 and W4 MUST match. Every prop
signature, sx value, color hex, polling interval, and state label is derived directly
from the live RNGD source code. Deviations require an explicit justification comment.

---

## 1. Component Hierarchy

```
RngdNpuEvalPage                        web/src/pages/npu-eval/rngd/index.tsx
  HardwareIdentityCard                 web/src/components/benchmark-page/HardwareIdentityCard.tsx
  <Box> — page header                  (inline, no component)
    <Button> — "RNGD vs GPU Comparison" nav button
    <Button> — "New RNGD Exam" toggle
  <Paper> — create exam form           (conditional: showForm === true)
    <Box component="form"> — react-hook-form grid
  <TableContainer> — exam list         (always rendered)
    <Table size="small">
      <TableHead> … 11 columns
      <TableBody>
        <TableRow> × N
          <Tt100tBadge>                web/src/components/Tt100tBadge (badge per row)
          <Chip> — status badge        (statusColor / statusLabel mapping)
  <Stack> — Pagination                 (rendered only when total_pages > 1)
  <Paper> — Active RNGD Benchmarks     (conditional: any exam status RUNNING/PREPARING/PENDING)
    ActiveBenchmarkCard × N            (inline component, not exported)
  LiveBenchDashboard                   web/src/components/benchmark-page/LiveBenchDashboard.tsx
  <Dialog> — delete confirmation       (conditional: deleteTarget !== null)

RngdDeviceComparisonPage               web/src/pages/npu-eval/rngd/device-comparison/index.tsx
  DeviceDashboardHeader                web/src/components/DeviceDashboardHeader/DeviceDashboardHeader.tsx
  <Alert> — error state                (conditional)
  ComparisonDiagnosticPanel            (conditional: isEmpty)
  ComparisonRunTable × 2               (RNGD runs + GPU runs, side by side)
  <Dialog> — side-by-side metric table (conditional: dialogOpen)
```

---

## 2. LiveBenchDashboard — Iframe Wrapper

**File:** `web/src/components/benchmark-page/LiveBenchDashboard.tsx`

### Prop Signature

```typescript
type Props = {
  title: string;   // required — rendered as Typography variant="h6" above iframe
  src: string;     // required — iframe src AND "open in new tab" href
  height?: number; // optional — default 900
};
```

### RNGD Usage (exact call site, line 434-438 of index.tsx)

```tsx
<LiveBenchDashboard
  title="Live Bench Dashboard (node4 — RNGD)"
  src="http://10.254.202.114:30890/"
  height={900}
/>
```

### Rendered Structure

```tsx
<Paper sx={{ p: 2, mt: 3 }}>
  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
    <Typography variant="h6">{title}</Typography>
    <Typography variant="caption">
      <a href={src} target="_blank" rel="noopener noreferrer"
         style={{ color: '#3aa3ff', textDecoration: 'none' }}>
        open in new tab ↗
      </a>
    </Typography>
  </Box>
  <Box
    component="iframe"
    src={src}
    title={title}
    sx={{ width: '100%', height, border: 0, borderRadius: 1, bgcolor: '#0e1117', display: 'block' }}
  />
</Paper>
```

### Dimensions & Styling

| Property | Value |
|---|---|
| iframe height (RNGD) | `900` (px) |
| iframe width | `100%` |
| iframe border | `0` |
| iframe borderRadius | MUI theme unit `1` (4px) |
| iframe background | `#0e1117` (dark — Streamlit/Grafana dark theme) |
| Paper padding | `p: 2` |
| Paper margin-top | `mt: 3` |
| "open in new tab" link color | `#3aa3ff` |

### URL / Prometheus Construction

The RNGD page uses a **static URL**: `http://10.254.202.114:30890/`

No dynamic Prometheus/Grafana URL construction occurs on the RNGD page itself.
The `src` prop is passed verbatim to the iframe. W3 and W4 MUST follow the same
pattern: pass the full URL as `src`, do not construct it inside `LiveBenchDashboard`.

---

## 3. HardwareIdentityCard

**File:** `web/src/components/benchmark-page/HardwareIdentityCard.tsx`

### Prop Signature

```typescript
type Field = { label: string; value: string };

type Props = {
  vendor: string;           // required — shown in body text
  model: string;            // required — shown in body text
  node: string;             // required — shown in body text
  count: string | number;   // required — shown in body text
  deviceId?: string;        // optional — appended "| ID: {deviceId}"
  devices?: Field[];        // optional — renders extra labeled fields row
  vendorColor?: string;     // optional — default '#F97316' (RNGD orange)
  extraInfo?: string;       // optional — renders as caption below main line
  badgeLabel?: string;      // optional — chip label; fallback "${vendor} ${model}"
};
```

### RNGD Usage (exact call site, lines 225-233 of index.tsx)

```tsx
<HardwareIdentityCard
  vendor="FuriosaAI"
  model="RNGD"
  node="node4"
  count={rngdInfo?.npu_count ?? 1}
  vendorColor="#F97316"
  badgeLabel="FuriosaAI RNGD"
  extraInfo={rngdInfo
    ? `${rngdInfo.memory_gb}GB HBM3 | ${rngdInfo.compute_tflops} TFLOPS | ${rngdInfo.npu_count} NPU(s) detected`
    : undefined}
/>
```

### Layout & Styling

```tsx
<Paper
  sx={{
    p: 2,
    mb: 3,
    border: `1px solid rgba(${rgb},0.25)`,   // rgb derived from vendorColor
    bgcolor: `rgba(${rgb},0.03)`,
  }}
>
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Typography variant="subtitle2" fontWeight={700} sx={{ color: vendorColor }}>
        Hardware Identity
      </Typography>
      <Typography variant="body2">
        Vendor: {vendor} | Model: {model} | Node: {node} | Count: {count}
        {deviceId ? <> | ID: {deviceId}</> : null}
      </Typography>
      {extraInfo && (
        <Typography variant="caption" color="text.secondary">{extraInfo}</Typography>
      )}
      {/* devices[] rendered as flex row of labeled fields when provided */}
    </Box>
    <Chip
      label={badgeLabel ?? `${vendor} ${model}`}
      sx={{
        bgcolor: `rgba(${rgb},0.12)`,
        color: vendorColor,
        fontWeight: 700,
        border: `1px solid rgba(${rgb},0.3)`,
      }}
    />
  </Box>
</Paper>
```

### Color Derivation

```typescript
function hexToRgb(hex: string): string {
  const h = hex.replace('#', '');
  const n = parseInt(h, 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}
// '#F97316' → '249,115,22'
```

For RNGD: all rgba values use `249,115,22` (orange).  
For GPU (W3): use the GPU vendor color (NVIDIA = `#4F46E5` → `79,70,229`).  
For Atom+ (W4): use `#A855F7` → `168,85,247` (purple).

---

## 4. Status Badge — Chip Behavior

### Status Label Map (used by RNGD table and ActiveBenchmarkCard)

```typescript
const statusLabel = (status: string) => {
  switch (status) {
    case 'Pending':    return 'Pending...';
    case 'Preparing':  return 'Preparing NPU...';
    case 'Running':    return 'Running on NPU...';
    case 'Completed':  return 'Completed';
    case 'Error':      return 'Error';
    case 'Stopped':    return 'Stopped';
    case 'Idle':       return 'Idle';
    default:           return status;
  }
};
```

### Status Color Map (MUI palette names)

```typescript
const statusColor = (status: string) => {
  switch (status) {
    case 'Completed':  return 'success';   // MUI green
    case 'Running':    return 'info';      // MUI blue
    case 'Preparing':  return 'info';      // MUI blue
    case 'Pending':    return 'warning';   // MUI amber
    case 'Error':      return 'error';     // MUI red
    case 'Stopped':    return 'warning';   // MUI amber
    default:           return 'default';
  }
};
```

### Pulse Animation (active states only)

Applied to RUNNING, PREPARING, PENDING chips:

```typescript
sx={{
  animation: 'pulse 1.5s infinite',
  '@keyframes pulse': {
    '0%':   { opacity: 1 },
    '50%':  { opacity: 0.6 },
    '100%': { opacity: 1 }
  }
}}
```

### DeviceRealtimeDashboard — StatusChip (exact hex colors)

Used in `DeviceRealtimeDashboard` for realtime slot status. These are NOT MUI palette
names — they are exact hex colors applied via `sx.bgcolor`:

```typescript
const StatusChipColorMap = {
  Running:      '#16A34A',  // green
  running:      '#16A34A',
  Completed:    '#4F46E5',  // indigo
  completed:    '#4F46E5',
  Queued:       '#D97706',  // amber
  queued:       '#D97706',
  Pending:      '#D97706',
  Preparing:    '#0284C7',  // sky blue
  preparing:    '#0284C7',
  Idle:         '#64748B',  // slate
  idle:         '#64748B',
  Failed:       '#DC2626',  // red
  failed:       '#DC2626',
  error:        '#DC2626',
  Stopped:      '#9333EA',  // purple
  Stale:        '#64748B',  // slate (gray)
  stale:        '#64748B',
  Unavailable:  '#DC2626',  // red + strikethrough
  unavailable:  '#DC2626',
  Unknown:      '#64748B',
  unknown:      '#64748B',
  'Pending Join': '#D97706',
  pending_join: '#D97706',
};
// All StatusChip chips use: color: '#fff', fontWeight: 600, fontSize: '0.6875rem'
// Unavailable additionally: textDecoration: 'line-through'
```

---

## 5. Polling / Refresh Behavior

### RNGD Page Polling

| Data source | Query key | Interval |
|---|---|---|
| `NpuEvalApi.list(...)` | `[NpuEvalQueryKeys.PREFIX, page, limit, 'rngd']` | `5000 ms` |
| `NpuEvalApi.npuList()` | `NpuEvalQueryKeys.npuList()` | none (no refetchInterval) |
| `ComparisonApi.list(...)` | `['comparison', 'list', 'rngd-tt100t']` | `5000 ms` |
| `NpuEvalApi.details(id)` (per active exam) | `NpuEvalQueryKeys.details(id)` | `5000 ms` (only when status is RUNNING/PREPARING/PENDING) |

### DeviceRealtimeDashboard Transport

Primary: **SSE (Server-Sent Events)** at `/realtime/exams`  
Fallback: **HTTP polling** at `/realtime/exams/snapshot`, interval `5000 ms`

Probe sequence:
1. GET `/realtime/exams/health` with `timeout: 3000 ms`
2. If HTTP 200 → open `EventSource` at `/realtime/exams`
3. If HTTP 503 or 404 → switch to poll immediately
4. SSE `onerror` → close EventSource, switch to poll

SSE event names listened: `'snapshot'` (NestJS Sse() envelope) and `'message'` (fallback for proxies that strip event names). `'ping'` frames are silently ignored.

### Device Registry Stale Time

```typescript
const STALE_TIME_MS = 30_000; // 30 seconds
```
Three parallel queries via `useQueries`: `DevicesApi.list`, `DevicesApi.nodes`, `DevicesApi.health`.

### Device Comparison Page

```typescript
refetchInterval: 30_000  // 30 seconds
```

---

## 6. Loading State

The RNGD page itself has **no skeleton/overlay loading state**. Data arrives via
`useQuery` and the page renders empty tables/cards until data resolves.

`DeviceRealtimeDashboard` loading states:

| Condition | Rendered output |
|---|---|
| `registryLoading === true` | `noDevicesMessage = 'Loading device registry…'` shown in centered Paper |
| `registryError !== null` | `noDevicesMessage = 'Device registry unavailable: {error.message}'` |
| `connected === false` (SSE not yet established) | Empty Paper: `'Connecting to realtime feed…'` |
| `devices.length === 0 && !registryLoading` | `'No {TYPE} devices registered. Check /api/devices.'` |

The `LinearProgress` inside `DeviceCard` is **indeterminate** and shown only when `status.toLowerCase() === 'running'`:

```tsx
<LinearProgress
  variant="indeterminate"
  sx={{
    mb: 1.5,
    borderRadius: 1,
    height: 4,
    bgcolor: `${color}22`,          // device color at 13% opacity
    '& .MuiLinearProgress-bar': { bgcolor: color }
  }}
/>
```

---

## 7. Stale State

Stale = a slot that was RUNNING in the DB but has not emitted a heartbeat for >2 min.

### Wire status name: `'stale'` → displayed label: `'Stale'`

```typescript
// STATUS_LABEL in useRealtimeExams.ts
stale: 'Stale'
```

### StatusChip appearance

```tsx
<Chip
  label="Stale"
  size="small"
  sx={{ bgcolor: '#64748B', color: '#fff', fontWeight: 600, fontSize: '0.6875rem' }}
/>
```
Color: `#64748B` (slate-500). No strikethrough.

### Stale banner inside DeviceCard

```tsx
{isStale && (
  <Typography
    variant="caption"
    sx={{ mt: 1.5, display: 'block', color: '#64748B', fontWeight: 600 }}
  >
    No heartbeat for >2 min — benchmark may have crashed.
    {slot?.last_seen
      ? ` Last seen: ${new Date(slot.last_seen).toLocaleTimeString()}`
      : ''}
  </Typography>
)}
```

Exact message format: `"No heartbeat for >2 min — benchmark may have crashed. Last seen: {HH:MM:SS AM/PM}"`  
(uses `toLocaleTimeString()`, locale-dependent, no explicit format string)

---

## 8. Unavailable / Error State

### Wire status name: `'unavailable'` → displayed label: `'Unavailable'`

### StatusChip appearance

```tsx
<Chip
  label="Unavailable"
  size="small"
  sx={{
    bgcolor: '#DC2626',         // red-600
    color: '#fff',
    fontWeight: 600,
    fontSize: '0.6875rem',
    textDecoration: 'line-through'   // RED STRIKETHROUGH — unique to Unavailable
  }}
/>
```

### DeviceCard opacity for pending_join state

```typescript
const isPending = device.state === 'pending_join' || device.k8s_node_status === 'Absent';
// DeviceCard Paper: opacity: isPending ? 0.7 : 1
```

Pending banner text:
```tsx
<Typography variant="caption"
  sx={{ mt: 1.5, display: 'block', color: '#D97706', fontWeight: 600 }}>
  Awaiting cluster join — slot reserved.
</Typography>
```

### Registry Health Chips (diagnostic row)

```tsx
// Source chip — green if 'k8s', amber if fallback
<Chip label={`Source: ${health.source_used}`} size="small" variant="outlined"
  sx={{
    fontSize: '0.6875rem',
    borderColor: health.source_used === 'k8s' ? '#16A34A' : '#D97706',
    color:       health.source_used === 'k8s' ? '#16A34A' : '#D97706',
  }} />

// k8s API reachability chip
<Chip label={health.k8s_api_reachable ? 'k8s API: Reachable' : 'k8s API: Unreachable'}
  size="small" variant="outlined"
  sx={{
    fontSize: '0.6875rem',
    borderColor: health.k8s_api_reachable ? '#16A34A' : '#DC2626',
    color:       health.k8s_api_reachable ? '#16A34A' : '#DC2626',
  }} />

// k8s error chip (shown only when health.k8s_api_error is truthy)
<Chip label="k8s error" size="small"
  sx={{ bgcolor: '#DC2626', color: '#fff', fontSize: '0.6875rem' }} />
```

---

## 9. DeviceCard Structure (full spec)

**File:** `web/src/components/DeviceRealtimeDashboard/DeviceRealtimeDashboard.tsx` (inline component)

### Paper wrapper

```tsx
<Paper sx={{ p: 2.5, borderTop: `3px solid ${color}`, height: '100%', opacity: isPending ? 0.7 : 1 }}>
```
`color` = `getDeviceColor(slotKeyFromDevice(device))` — see device color table in §11.

### Header row

```tsx
<Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
  {/* Circular badge: 'NPU', 'GPU', or 'CPU' */}
  <Box sx={{
    width: 32, height: 32, borderRadius: '50%',
    background: `linear-gradient(135deg, ${color}, ${color}99)`,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#fff', fontWeight: 700, fontSize: '0.75rem', flexShrink: 0
  }}>
    {badgeText}  {/* 'NPU' for RNGD/Atom+; 'GPU' for GPU devices */}
  </Box>

  <Box sx={{ flex: 1, minWidth: 0 }}>
    <Typography fontWeight={700} fontSize="0.875rem" noWrap title={label}>
      {label}  {/* deviceLabel(device) = 'FuriosaAI RNGD', 'NVIDIA L40', etc. */}
    </Typography>
    <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexWrap: 'wrap', mt: 0.25 }}>
      {/* Vendor chip — solid fill */}
      <Chip label={vendorDisplay} size="small"
        sx={{ bgcolor: vendorColor, color: '#fff', fontWeight: 600, fontSize: '0.625rem', height: 18 }} />
      {/* Model chip — outlined */}
      <Chip label={device.model} size="small" variant="outlined"
        sx={{ fontWeight: 500, fontSize: '0.625rem', height: 18, borderColor: color, color }} />
      {/* Registry state chip — outlined */}
      <RegistryStateChip state={device.state} />
      {/* Node label */}
      <Typography variant="caption" color="text.secondary" noWrap>
        {device.node}{device.slot_id !== undefined ? ` #${device.slot_id}` : ''}
      </Typography>
    </Box>
  </Box>

  <StatusChip status={status} />
</Box>
```

### Metrics grid (2-column)

```tsx
<Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
  {/* Exam ID */}
  <Box>
    <Typography variant="caption" color="text.secondary">Exam ID</Typography>
    <Typography fontSize="0.8125rem" fontWeight={600}>{slot?.exam_id ?? '—'}</Typography>
  </Box>
  {/* Elapsed */}
  <Box>
    <Typography variant="caption" color="text.secondary">Elapsed</Typography>
    <Typography fontSize="0.8125rem" fontWeight={600}>
      {slot?.elapsed_seconds != null ? `${slot.elapsed_seconds}s` : '—'}
    </Typography>
  </Box>
  {/* TPS */}
  <Box>
    <Typography variant="caption" color="text.secondary">TPS</Typography>
    <Typography fontSize="0.8125rem" fontWeight={600}>
      {slot?.tps != null ? slot.tps.toFixed(2) : '—'}
    </Typography>
  </Box>
  {/* TT100T */}
  <Box>
    <Typography variant="caption" color="text.secondary">TT100T (s)</Typography>
    <Typography fontSize="0.8125rem" fontWeight={600}>
      {slot?.tt100t != null ? slot.tt100t.toFixed(3) : '—'}
    </Typography>
  </Box>
</Box>
```

### RegistryStateChip (device.state values)

```typescript
const STATE_CHIP = {
  ready:        { label: 'Ready',        color: '#16A34A' },
  pending_join: { label: 'Pending Join', color: '#D97706' },
  not_ready:    { label: 'Not Ready',    color: '#DC2626' },
  degraded:     { label: 'Degraded',     color: '#EA580C' },
  unknown:      { label: 'Unknown',      color: '#64748B' },
};
// Chip: variant="outlined", height: 18, fontSize: '0.625rem', fontWeight: 600
```

---

## 10. Device Grid Layout (DeviceRealtimeDashboard)

```tsx
<Box sx={{
  display: 'grid',
  gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', xl: 'repeat(4, 1fr)' },
  gap: 2.5,
  mb: 3
}}>
```

### Responsive breakpoints

| Breakpoint | Columns |
|---|---|
| `xs` (0px+) | 1 |
| `sm` (600px+) | 2 |
| `xl` (1536px+) | 4 |

---

## 11. Label / Metric Naming Conventions

### Slot join key (`gpu_type` field)

Constructed by `slotKeyFromDevice()`:
```typescript
`${d.vendor.toUpperCase()}-${d.model}`
// 'FURIOSA-RNGD'
// 'NVIDIA-L40'
// 'REBELLIONS-Atom+'  ← mixed case: model case is preserved exactly
```

### Device color lookup keys

| Device | Slot key | Color |
|---|---|---|
| RNGD | `'FURIOSA-RNGD'` or `'RNGD'` | `#14B8A6` (teal) |
| NVIDIA L40 | `'NVIDIA-L40'` | `#4F46E5` (indigo) |
| NVIDIA A40 | `'NVIDIA-A40'` | `#7C3AED` (violet) |
| NVIDIA L40-44GiB | `'NVIDIA-L40-44GiB'` | `#0284C7` (sky) |
| NVIDIA A40-44GiB | `'NVIDIA-A40-44GiB'` | `#0F766E` (teal-dark) |
| Atom+ | `'REBELLIONS-Atom+'` | `#A855F7` (purple) |
| NPU fallback | any key containing 'NPU' | `#F97316` (orange) |
| GPU fallback | any key containing 'GPU' or NVIDIA | `#4F46E5` |

### Vendor display names (VENDOR_DISPLAY in DeviceRealtimeDashboard)

```typescript
const VENDOR_DISPLAY = {
  nvidia:      'NVIDIA',
  furiosa:     'FuriosaAI',
  rebellions:  'Rebellions',
  intel:       'Intel'
};
```

### Vendor colors (VENDOR_COLORS)

```typescript
NVIDIA:     '#4F46E5'
FuriosaAI:  '#14B8A6'
Rebellions: '#A855F7'
Intel:      '#0284C7'
```

### Metric display format

| Metric | Format |
|---|---|
| TPS | `tps.toFixed(2)` |
| TT100T | `tt100t.toFixed(3)` |
| Elapsed | `` `${elapsed_seconds}s` `` |
| TT100T threshold | < 1.1 s = `color: 'success.main'`, fontWeight: 600 |

### Wire status → display label (STATUS_LABEL in useRealtimeExams.ts)

```typescript
idle:         'Idle'
queued:       'Queued'
running:      'Running'
preparing:    'Preparing'
completed:    'Completed'
failed:       'Failed'
stale:        'Stale'
unavailable:  'Unavailable'
unknown:      'Unknown'
error:        'Failed'      // NOTE: 'error' wire → 'Failed' display
pending_join: 'Pending Join'
```

---

## 12. DeviceDashboardHeader

**File:** `web/src/components/DeviceDashboardHeader/DeviceDashboardHeader.tsx`

```typescript
type Props = {
  title: string;
  description: string;
  chipLabel?: string;
  chipColor?: string;  // default '#4F46E5'
};
```

```tsx
<Box sx={{ mb: 3 }}>
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.75 }}>
    <Typography variant="h5" fontWeight={700}>{title}</Typography>
    {chipLabel && (
      <Chip label={chipLabel} size="small"
        sx={{ bgcolor: chipColor, color: '#fff', fontWeight: 600, fontSize: '0.6875rem' }} />
    )}
  </Box>
  <Typography variant="body2" color="text.secondary">{description}</Typography>
</Box>
```

### RNGD Comparison page usage

```tsx
<DeviceDashboardHeader
  title="RNGD NPU vs GPU — Cross-Device Comparison"
  description="Select one completed FuriosaAI RNGD run and one MLPerf GPU run, then click Compare for a metric-by-metric breakdown."
  chipLabel="RNGD Only"
  chipColor="#F97316"
/>
```

---

## 13. BenchmarkPageShell

**File:** `web/src/components/benchmark-page/BenchmarkPageShell.tsx`

The RNGD page does NOT use `BenchmarkPageShell` — it uses its own inline header.
`BenchmarkPageShell` is available for W3/W4 to use as an alternative shell if desired,
but it is NOT part of the RNGD contract and must not be assumed equivalent.

```typescript
type Props = {
  title: string;
  subtitle?: string;
  vendorBadgeLabel: string;
  vendorColor: string;
  actions?: Array<{ label: string; onClick: () => void; icon?: React.ReactNode; color?: string; borderColor?: string }>;
  onPrimary?: { label: string; onClick: () => void; active?: boolean; activeLabel?: string };
  children: React.ReactNode;
};
```

---

## 14. ReadinessSummary

**File:** `web/src/components/benchmark-page/ReadinessSummary.tsx`

The RNGD page does NOT use `ReadinessSummary`. It is available for other pages.
Exported from `@/components/benchmark-page` index.

```typescript
type ReadinessItem = { Icon: SvgIconComponent; title: string; detail: string };
type Props = {
  title: string; summary: string;
  items: readonly ReadinessItem[];
  footerText?: string; footerLinkLabel?: string; footerLinkHref?: string;
};
```

Alert styling: `severity="success"`, border `1px solid rgba(22,163,74,0.4)`,
bgcolor `rgba(240,253,244,0.8)`, icon color `#15803D`.

---

## 15. Active Benchmark Panel (inline — not a shared component)

Rendered when any exam has status RUNNING, PREPARING, or PENDING:

```tsx
<Paper sx={{ p: 3, mt: 3, border: '1px solid rgba(249,115,22,0.3)', bgcolor: 'rgba(249,115,22,0.02)' }}>
  <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
    {/* Animated pulse dot */}
    <Box sx={{
      width: 10, height: 10, borderRadius: '50%', bgcolor: '#F97316',
      animation: 'pulse 1.5s infinite',
      '@keyframes pulse': { '0%': { opacity: 1 }, '50%': { opacity: 0.4 }, '100%': { opacity: 1 } }
    }} />
    Active RNGD Benchmarks
  </Typography>
  {activeExams.map(exam => <ActiveBenchmarkCard key={exam.id} exam={exam} />)}
</Paper>
```

### ActiveBenchmarkCard progress bar

```tsx
<Box sx={{ mt: 1.5, height: 6, bgcolor: 'rgba(0,0,0,0.06)', borderRadius: 3, overflow: 'hidden' }}>
  <Box sx={{
    height: '100%', borderRadius: 3,
    bgcolor: realProgress ? '#16A34A' : '#F97316',  // green if real data, orange if estimated
    width: `${pct}%`,
    transition: 'width 0.5s ease',
  }} />
</Box>
```

Progress estimation when no real data:
- PENDING → 5%
- PREPARING → 12%
- Real data → `Math.min(100, (samplesDone / total) * 100)`

---

## 16. Component Exports (benchmark-page index)

```typescript
// web/src/components/benchmark-page/index.ts
export { BenchmarkPageShell } from './BenchmarkPageShell';
export { HardwareIdentityCard } from './HardwareIdentityCard';
export { ReadinessSummary } from './ReadinessSummary';
export type { ReadinessItem } from './ReadinessSummary';
export { LiveBenchDashboard } from './LiveBenchDashboard';
```

Import path: `@/components/benchmark-page`

---

## 17. W3 / W4 Deviation Rules

W3 (GPU realtime) and W4 (Atom+) MUST:

1. Use `LiveBenchDashboard` with their own `src` URL and `title`. Height SHOULD be `900` unless the embedded dashboard requires a different height — document the deviation.
2. Use `HardwareIdentityCard` with their vendor color: GPU = `#4F46E5`, Atom+ = `#A855F7`.
3. Use `StatusChip` with the exact hex color map from §4. Do NOT substitute MUI palette names.
4. Use `slotKeyFromDevice()` for slot-join keys. Do NOT hardcode slot key strings.
5. Render the stale banner with the exact message format from §7.
6. Render the `Unavailable` chip with `textDecoration: 'line-through'` — no exceptions.
7. Use `refetchInterval: 5000` for exam list queries (matching RNGD polling interval).
8. Use `DeviceDashboardHeader` with their own title/description/chipLabel/chipColor.
9. Follow the device grid breakpoints exactly: xs=1, sm=2, xl=4 columns.
10. Format TPS as `.toFixed(2)` and TT100T as `.toFixed(3)`.

W3 and W4 MAY differ in:
- `src` URL for `LiveBenchDashboard`
- `vendorColor` for `HardwareIdentityCard`
- `chipColor` for `DeviceDashboardHeader`
- `title`, `description`, `badgeLabel` strings
- Which device types are filtered via `deviceType` prop of `DeviceRealtimeDashboard`

---

*Contract generated from source read on 2026-05-06. Re-derive from source if files change.*
