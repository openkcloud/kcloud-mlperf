import {
  Box,
  Chip,
  LinearProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
  useTheme
} from '@mui/material';
import { BarChart } from '@mui/x-charts/BarChart';
import { LineChart } from '@mui/x-charts/LineChart';

import type { DeviceEntry, DeviceState, DeviceVendor } from '@/api/types/devices.types';
import { DeviceDashboardHeader } from '@/components/DeviceDashboardHeader';
import { DEVICE_COLORS, getDeviceColor, getVendorColor } from '@/constants/device-colors';
import { statusColor } from '@/components/home/deviceAggregates';

import { deviceLabel, slotKeyFromDevice, useDeviceRegistry } from '@/hooks/useDeviceRegistry';
import { telemetryHistoryKey, useRealtimeExams } from '@/hooks/useRealtimeExams';
import type {
  RealtimeExamSlot,
  TelemetryHistory,
  WireSlotTelemetry
} from '@/hooks/useRealtimeExams';

/**
 * Render `value` to `digits` fixed places, or '—' when undefined/null.
 * Used by the per-card telemetry tiles so we never display fake zeros — but
 * once Prometheus has emitted a sample (even `0`) we DO render it, because
 * the backend has already validated `exporter_status === 'ok'`.
 */
const fmt = (value: number | undefined | null, digits = 0, suffix = ''): string => {
  if (value === undefined || value === null || Number.isNaN(value)) return '—';
  return `${value.toFixed(digits)}${suffix}`;
};

/** Pick the right utilization field by device type. Returns undefined when the
 *  telemetry is absent OR when the exporter is not in 'ok' state — callers must
 *  never coerce the result to 0 for display purposes (M1). */
const utilPct = (t: WireSlotTelemetry | null | undefined, deviceType: 'gpu' | 'npu' | 'cpu'): number | undefined => {
  if (!t) return undefined;
  // If exporter is not reporting cleanly, treat as unavailable rather than 0 (M1).
  if (t.exporter_status && t.exporter_status !== 'ok') return undefined;
  if (deviceType === 'gpu') return t.gpu_util_pct;
  return t.util_pct;
};

/** Return true when the exporter is in a non-ok state (timeout, unavailable, …) */
const isExporterUnavailable = (t: WireSlotTelemetry | null | undefined): boolean => {
  if (!t) return false;
  return !!(t.exporter_status && t.exporter_status !== 'ok');
};

/** Staleness threshold in seconds above which telemetry data is considered stale (M2). */
const TELEMETRY_STALE_SECONDS = 15;

/** Compose the DRAM / FB usage tile string ("used / total GB" or "MiB"). */
const memUsage = (t: WireSlotTelemetry | null | undefined, deviceType: 'gpu' | 'npu' | 'cpu'): string => {
  if (!t) return '—';
  if (deviceType === 'gpu') {
    if (t.fb_used_mib === undefined || t.fb_total_mib === undefined) return '—';
    return `${(t.fb_used_mib / 1024).toFixed(1)} / ${(t.fb_total_mib / 1024).toFixed(1)} GiB`;
  }
  if (t.dram_used_gb === undefined || t.dram_total_gb === undefined) return '—';
  return `${t.dram_used_gb.toFixed(1)} / ${t.dram_total_gb.toFixed(1)} GB`;
};

// -----------------------------------------------------------------------

export type DeviceTypeFilter = 'gpu' | 'npu' | 'all';

const TITLES: Record<DeviceTypeFilter, { title: string; description: string; chipLabel: string }> =
  {
    gpu: {
      title: 'GPU Real-Time Dashboard',
      description: 'Live benchmark status across all GPU nodes.',
      chipLabel: 'GPU Live'
    },
    npu: {
      title: 'NPU Real-Time Dashboard',
      description: 'Live benchmark status across all NPU nodes (RNGD, Atom+).',
      chipLabel: 'NPU Live'
    },
    all: {
      title: 'Device Real-Time Dashboard',
      description: 'Live benchmark status across all GPU and NPU nodes.',
      chipLabel: 'All Devices'
    }
  };

const headerChipColor = (deviceType: DeviceTypeFilter): string => {
  if (deviceType === 'npu') return DEVICE_COLORS.NPU;
  return DEVICE_COLORS.GPU;
};

const VENDOR_DISPLAY: Record<DeviceVendor, string> = {
  nvidia: 'NVIDIA',
  furiosa: 'FuriosaAI',
  rebellions: 'Rebellions',
  intel: 'Intel'
};

// STATE_CHIP colors are referenced only inside components that call useTheme(),
// so we keep the static label map and derive the color at render time via statusColor().
const STATE_CHIP_LABEL: Record<DeviceState, { label: string; kind: 'success' | 'warning' | 'error' | 'neutral' }> = {
  ready: { label: 'Ready', kind: 'success' },
  pending_join: { label: 'Pending Join', kind: 'warning' },
  not_ready: { label: 'Not Ready', kind: 'error' },
  degraded: { label: 'Degraded', kind: 'warning' },
  unknown: { label: 'Unknown', kind: 'neutral' }
};

// -----------------------------------------------------------------------

type StatusChipProps = { status: string };

const StatusChip = ({ status }: StatusChipProps) => {
  // StatusChip uses a solid-background style (color: '#fff'), so the background
  // itself is the brand color. These are already saturated enough to carry white
  // text on both themes — no mode switch needed for the bg. We keep '#fff' fg.
  const map: Record<string, { label: string; color: string; strikethrough?: boolean }> = {
    Running: { label: 'Running', color: '#16A34A' },
    running: { label: 'Running', color: '#16A34A' },
    Completed: { label: 'Completed', color: '#4F46E5' },
    completed: { label: 'Completed', color: '#4F46E5' },
    Queued: { label: 'Queued', color: '#D97706' },
    queued: { label: 'Queued', color: '#D97706' },
    Pending: { label: 'Pending', color: '#D97706' },
    Preparing: { label: 'Preparing', color: '#0284C7' },
    preparing: { label: 'Preparing', color: '#0284C7' },
    Idle: { label: 'Idle', color: '#64748B' },
    idle: { label: 'Idle', color: '#64748B' },
    Failed: { label: 'Failed', color: '#DC2626' },
    failed: { label: 'Failed', color: '#DC2626' },
    error: { label: 'Error', color: '#DC2626' },
    Stopped: { label: 'Stopped', color: '#9333EA' },
    // Stale: RUNNING in DB but heartbeat >2 min ago — rendered gray
    Stale: { label: 'Stale', color: '#64748B' },
    stale: { label: 'Stale', color: '#64748B' },
    // Unavailable: hardware absent from device registry — red strike
    Unavailable: { label: 'Unavailable', color: '#DC2626', strikethrough: true },
    unavailable: { label: 'Unavailable', color: '#DC2626', strikethrough: true },
    Unknown: { label: 'Unknown', color: '#64748B' },
    unknown: { label: 'Unknown', color: '#64748B' },
    'Pending Join': { label: 'Pending Join', color: '#D97706' },
    pending_join: { label: 'Pending Join', color: '#D97706' }
  };
  const cfg = map[status] ?? { label: status, color: '#64748B' };
  return (
    <Chip
      label={cfg.label}
      size="small"
      sx={{
        bgcolor: cfg.color,
        color: '#fff',
        fontWeight: 600,
        fontSize: '0.6875rem',
        ...(cfg.strikethrough ? { textDecoration: 'line-through' } : {})
      }}
    />
  );
};

const RegistryStateChip = ({ state }: { state: DeviceState }) => {
  const { palette } = useTheme();
  const mode = palette.mode;
  const cfg = STATE_CHIP_LABEL[state] ?? STATE_CHIP_LABEL.unknown;
  const color = statusColor(cfg.kind, mode);
  return (
    <Chip
      label={cfg.label}
      size="small"
      variant="outlined"
      sx={{
        borderColor: color,
        color,
        fontWeight: 600,
        fontSize: '0.625rem',
        height: 18
      }}
    />
  );
};

// -----------------------------------------------------------------------

type DeviceCardProps = {
  device: DeviceEntry;
  slot: RealtimeExamSlot | null;
  telemetryHistory: TelemetryHistory;
};

const DeviceCard = ({ device, slot, telemetryHistory }: DeviceCardProps) => {
  const { palette } = useTheme();
  const mode = palette.mode;
  const slotKey = slotKeyFromDevice(device);
  const color = getDeviceColor(slotKey);
  const vendorColor = getVendorColor(VENDOR_DISPLAY[device.vendor] ?? device.vendor, mode);
  const status = slot?.status ?? (device.state === 'ready' ? 'Idle' : 'Pending');

  // Latest telemetry is always sourced from the slot (idle slots already
  // emit telemetry in the snapshot). The history buffer is keyed by
  // `${node}/${slot_id}` and may be undefined on the very first frame.
  const telemetry: WireSlotTelemetry | null = slot?.telemetry ?? null;
  // slot_id is always a required number on DeviceEntry; no undefined guard needed.
  // Even idle devices emit telemetry in every SSE snapshot, so history is
  // populated regardless of whether an exam is running.
  const historyKey = telemetryHistoryKey(device.node, device.slot_id);
  const history = telemetryHistory[historyKey];

  // M1: never coerce missing util to 0. Filter out frames where utilPct
  // returns undefined (i.e. exporter_status !== 'ok' or field absent).
  // Only append real numeric values to the sparkline series.
  const utilSeries: number[] = (history ?? []).reduce<number[]>((acc, t) => {
    const u = utilPct(t, device.type as 'gpu' | 'npu' | 'cpu');
    if (u !== undefined) acc.push(u);
    return acc;
  }, []);
  const xAxisIdx: number[] = utilSeries.map((_v, i) => i);

  // M1: exporter unavailable / timeout — show caption instead of sparkline.
  const exporterUnavailable = isExporterUnavailable(telemetry);

  // M2: telemetry data staleness — distinct from transport "Live/Offline".
  const telemetryAgeSeconds = telemetry?.age_seconds;
  const isTelemetryStale =
    telemetryAgeSeconds !== undefined &&
    telemetryAgeSeconds !== null &&
    telemetryAgeSeconds > TELEMETRY_STALE_SECONDS;
  const isRunning = status.toLowerCase() === 'running';
  const isStale = status.toLowerCase() === 'stale';
  const badgeText = device.type === 'npu' ? 'NPU' : device.type === 'cpu' ? 'CPU' : 'GPU';
  const label = deviceLabel(device);
  const isPending = device.state === 'pending_join' || device.k8s_node_status === 'Absent';

  return (
    <Paper
      component="section"
      aria-label={`${label} — ${device.vendor} ${device.model} on ${device.node}${
        device.slot_id !== undefined ? ` #${device.slot_id}` : ''
      }, status ${status}`}
      sx={{ p: 2.5, borderTop: `3px solid ${color}`, height: '100%', opacity: isPending ? 0.7 : 1 }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
        <Box
          aria-hidden
          sx={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: `linear-gradient(135deg, ${color}, ${color}99)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontWeight: 700,
            fontSize: '0.75rem',
            flexShrink: 0
          }}
        >
          {badgeText}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography fontWeight={700} fontSize="0.875rem" noWrap title={label}>
            {label}
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexWrap: 'wrap', mt: 0.25 }}>
            <Chip
              label={VENDOR_DISPLAY[device.vendor] ?? device.vendor}
              size="small"
              sx={{
                bgcolor: vendorColor,
                color: '#fff',
                fontWeight: 600,
                fontSize: '0.625rem',
                height: 18
              }}
            />
            <Chip
              label={device.model}
              size="small"
              variant="outlined"
              sx={{ fontWeight: 500, fontSize: '0.625rem', height: 18, borderColor: color, color }}
            />
            <Tooltip title={`k8s: ${device.k8s_node_status} • source: ${device.source}`}>
              <span>
                <RegistryStateChip state={device.state} />
              </span>
            </Tooltip>
            <Typography variant="caption" color="text.secondary" noWrap>
              {device.node}
              {device.slot_id !== undefined ? ` #${device.slot_id}` : ''}
            </Typography>
          </Box>
        </Box>
        <StatusChip status={status} />
      </Box>

      {isRunning && (
        <LinearProgress
          variant="indeterminate"
          sx={{
            mb: 1.5,
            borderRadius: 1,
            height: 4,
            bgcolor: `${color}22`,
            '& .MuiLinearProgress-bar': { bgcolor: color }
          }}
        />
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
        <Box>
          <Typography variant="caption" color="text.secondary">
            Exam ID
          </Typography>
          <Typography fontSize="0.8125rem" fontWeight={600}>
            {slot?.exam_id ?? '—'}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">
            Elapsed
          </Typography>
          <Typography fontSize="0.8125rem" fontWeight={600}>
            {slot?.elapsed_seconds != null ? `${slot.elapsed_seconds}s` : '—'}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">
            TPS
          </Typography>
          <Typography fontSize="0.8125rem" fontWeight={600}>
            {slot?.tps != null ? slot.tps.toFixed(2) : '—'}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">
            TT100T (s)
          </Typography>
          <Typography fontSize="0.8125rem" fontWeight={600}>
            {slot?.tt100t != null ? slot.tt100t.toFixed(3) : '—'}
          </Typography>
        </Box>
      </Box>

      {/* Telemetry tile row: util %, power W, temp C, DRAM/FB used/total.
          Always rendered — idle slots still get fresh values from SSE.
          M2: dim the entire tile row when telemetry data is stale (age > threshold). */}
      <Box
        sx={{
          mt: 1.25,
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 1,
          pt: 1,
          borderTop: '1px dashed rgba(0,0,0,0.08)',
          // M2: dim tiles to signal stale data; transport "Live" chip is unchanged
          opacity: isTelemetryStale ? 0.5 : 1,
          transition: 'opacity 0.3s'
        }}
      >
        <Box>
          <Typography variant="caption" color="text.secondary">
            Util %
          </Typography>
          <Typography fontSize="0.8125rem" fontWeight={600}>
            {fmt(utilPct(telemetry, device.type as 'gpu' | 'npu' | 'cpu'), 0, '%')}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">
            Power W
          </Typography>
          <Typography fontSize="0.8125rem" fontWeight={600}>
            {fmt(telemetry?.power_w, 1)}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">
            Temp °C
          </Typography>
          <Typography fontSize="0.8125rem" fontWeight={600}>
            {fmt(telemetry?.temp_c, 1)}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">
            {device.type === 'gpu' ? 'FB' : 'DRAM'}
          </Typography>
          <Typography fontSize="0.75rem" fontWeight={600} noWrap>
            {memUsage(telemetry, device.type as 'gpu' | 'npu' | 'cpu')}
          </Typography>
        </Box>
      </Box>

      {/* M2: telemetry staleness badge — distinct from transport connection status. */}
      {isTelemetryStale && (
        <Chip
          label={`Telemetry stale (${Math.round(telemetryAgeSeconds!)}s old)`}
          size="small"
          variant="outlined"
          sx={{
            mt: 0.75,
            fontSize: '0.625rem',
            height: 18,
            borderColor: statusColor('warning', mode),
            color: statusColor('warning', mode)
          }}
        />
      )}

      {/* Utilization sparkline — last 60 readings (~2 min @ 2s cadence).
          M1: show "exporter unavailable" caption instead of a fake 0% sparkline
          when exporter_status !== 'ok' (e.g. Atom+ timeout). */}
      <Box sx={{ mt: 1, height: 60 }}>
        {exporterUnavailable ? (
          <Typography variant="caption" color="text.secondary" sx={{ pl: 0.5 }}>
            Exporter unavailable ({telemetry?.exporter_status ?? 'unknown'}) — util history paused.
          </Typography>
        ) : utilSeries.length > 1 ? (
          <LineChart
            xAxis={[{ data: xAxisIdx, scaleType: 'point', disableTicks: true, disableLine: true }]}
            series={[
              {
                data: utilSeries,
                color,
                showMark: false,
                area: true,
                curve: 'monotoneX',
                valueFormatter: (v: number | null) => (v == null ? '—' : `${v.toFixed(0)}%`)
              }
            ]}
            yAxis={[{ min: 0, max: 100, disableLine: true, disableTicks: true }]}
            height={60}
            margin={{ top: 4, right: 4, bottom: 4, left: 4 }}
            slotProps={{ legend: { sx: { display: 'none' } } }}
            sx={{
              '& .MuiChartsAxis-root': { display: 'none' },
              '& .MuiAreaElement-root': { fillOpacity: 0.15 }
            }}
          />
        ) : (
          <Typography variant="caption" color="text.secondary" sx={{ pl: 0.5 }}>
            Collecting utilization history…
          </Typography>
        )}
      </Box>

      {isPending && (
        <Typography
          variant="caption"
          sx={{ mt: 1.5, display: 'block', color: statusColor('warning', mode), fontWeight: 600 }}
        >
          Awaiting cluster join — slot reserved.
        </Typography>
      )}

      {isStale && (
        <Typography
          variant="caption"
          sx={{ mt: 1.5, display: 'block', color: statusColor('neutral', mode), fontWeight: 600 }}
        >
          No heartbeat for &gt;2 min — benchmark may have crashed.
          {slot?.last_seen
            ? ` Last seen: ${new Date(slot.last_seen).toLocaleTimeString()}`
            : ''}
        </Typography>
      )}

      {slot?.exam_name && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{
            mt: 1.5,
            display: 'block',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
        >
          {slot.exam_name}
        </Typography>
      )}
    </Paper>
  );
};

// -----------------------------------------------------------------------

type Props = {
  /** Which devices to show. Default 'gpu' for backwards compatibility. */
  deviceType?: DeviceTypeFilter;
  /** Optional benchmark filter ('mlperf' | 'mmlu' | undefined = all) */
  benchmarkFilter?: string;
};

export const DeviceRealtimeDashboard = ({ deviceType = 'gpu', benchmarkFilter }: Props) => {
  const { palette } = useTheme();
  const mode = palette.mode;
  const {
    devices,
    health,
    isLoading: registryLoading,
    error: registryError
  } = useDeviceRegistry({ deviceType });
  const { snapshot, connected, error, telemetryHistory } = useRealtimeExams();

  const allSlots = snapshot?.slots ?? [];
  const progress = snapshot?.sweep_progress ?? { completed: 0, total: 96, paused: true };
  const raceAlerts = snapshot?.operator_race_alerts ?? 0;

  const slots = benchmarkFilter
    ? allSlots.filter(
        s =>
          s.exam_name != null && s.exam_name.toLowerCase().includes(benchmarkFilter.toLowerCase())
      )
    : allSlots;

  // R1: filter the slots for the table (and its empty-state) by device type.
  // The device CARDS are already type-filtered via useDeviceRegistry({deviceType}),
  // but the table was rendering the unfiltered global slot list.  deviceType==='all'
  // shows every slot; gpu/npu dashboards show only slots for that type.
  const typeSlots = deviceType === 'all'
    ? slots
    : slots.filter(s => s.device_type === deviceType);

  const getSlotForDevice = (device: DeviceEntry): RealtimeExamSlot | null => {
    // Join by node + slot_id (the only per-device-unique key). Matching on the
    // model string is wrong twice over: the slot's `gpu_type` is the bare model
    // ("A30") while slotKeyFromDevice() returns "<VENDOR>-<model>" ("NVIDIA-A30"),
    // so the equality never holds and every card renders telemetry as "—"; and
    // even if normalized, two same-model devices (jw2/jw3 A30, node5 Atom+ #0/#1)
    // would both collide onto the first matching slot.
    return slots.find(s => s.node === device.node && s.slot_id === device.slot_id) ?? null;
  };

  const chartLabels = devices.map(d => d.model);
  const chartTps = devices.map(d => getSlotForDevice(d)?.tps ?? 0);
  const chartColors = devices.map(d => getDeviceColor(slotKeyFromDevice(d)));

  const progressPct = progress.total > 0 ? (progress.completed / progress.total) * 100 : 0;

  const titleCfg = TITLES[deviceType];
  const headerChip = headerChipColor(deviceType);
  const sweepBarColor = headerChip;

  const noDevicesMessage = registryLoading
    ? 'Loading device registry…'
    : registryError
      ? `Device registry unavailable: ${registryError.message}`
      : `No ${deviceType === 'all' ? '' : deviceType.toUpperCase() + ' '}devices registered. Check /api/devices.`;

  return (
    <Box>
      <DeviceDashboardHeader
        title={titleCfg.title}
        description={titleCfg.description}
        chipLabel={titleCfg.chipLabel}
        chipColor={headerChip}
      />

      {/* Registry diagnostics row */}
      {health && (
        <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Chip
            label={`Source: ${health.source_used}`}
            size="small"
            variant="outlined"
            sx={{
              fontSize: '0.6875rem',
              borderColor: health.source_used === 'k8s' ? statusColor('success', mode) : statusColor('warning', mode),
              color: health.source_used === 'k8s' ? statusColor('success', mode) : statusColor('warning', mode)
            }}
          />
          <Chip
            label={health.k8s_api_reachable ? 'k8s API: Reachable' : 'k8s API: Unreachable'}
            size="small"
            variant="outlined"
            sx={{
              fontSize: '0.6875rem',
              borderColor: health.k8s_api_reachable ? statusColor('success', mode) : statusColor('error', mode),
              color: health.k8s_api_reachable ? statusColor('success', mode) : statusColor('error', mode)
            }}
          />
          {health.k8s_api_error && (
            <Tooltip title={health.k8s_api_error}>
              <Chip
                label="k8s error"
                size="small"
                sx={{ bgcolor: '#DC2626', color: '#fff', fontSize: '0.6875rem' }}
              />
            </Tooltip>
          )}
          <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
            Refresh: {new Date(health.last_refresh).toLocaleTimeString()}
          </Typography>
        </Box>
      )}

      {/* Connection status banners */}
      {error && (
        <Box
          sx={{
            mb: 2,
            p: 1.5,
            bgcolor: 'rgba(217,119,6,0.08)',
            border: '1px solid rgba(217,119,6,0.25)',
            borderRadius: 1
          }}
        >
          <Typography variant="body2" color="warning.main">
            {error}
          </Typography>
        </Box>
      )}
      {raceAlerts > 0 && (
        <Box
          sx={{
            mb: 2,
            p: 1.5,
            bgcolor: 'rgba(220,38,38,0.06)',
            border: '1px solid rgba(220,38,38,0.2)',
            borderRadius: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 1
          }}
        >
          <Chip
            label={`${raceAlerts} operator race alert${raceAlerts > 1 ? 's' : ''}`}
            size="small"
            color="error"
          />
          <Typography variant="body2" color="error.main">
            Cells will auto-requeue with stagger.
          </Typography>
        </Box>
      )}

      {/* Sweep progress */}
      <Paper sx={{ p: 2.5, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Typography fontWeight={600} fontSize="0.9375rem">
            Sweep Progress
            {benchmarkFilter && (
              <Chip
                label={benchmarkFilter.toUpperCase()}
                size="small"
                variant="outlined"
                sx={{ ml: 1 }}
              />
            )}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {progress.paused && (
              <Chip label="Paused" size="small" sx={{ bgcolor: '#64748B', color: '#fff' }} />
            )}
            <Typography variant="body2" color="text.secondary">
              {progress.completed} / {progress.total} cells
            </Typography>
            <Chip
              label={connected ? 'Live' : 'Offline'}
              size="small"
              sx={{ bgcolor: connected ? '#16A34A' : '#64748B', color: '#fff', fontWeight: 600 }}
            />
          </Box>
        </Box>
        <LinearProgress
          variant="determinate"
          value={progressPct}
          sx={{
            height: 8,
            borderRadius: 4,
            bgcolor: 'rgba(79,70,229,0.12)',
            '& .MuiLinearProgress-bar': { bgcolor: sweepBarColor }
          }}
        />
      </Paper>

      {/* Device Cards */}
      {devices.length > 0 ? (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', xl: 'repeat(4, 1fr)' },
            gap: 2.5,
            mb: 3
          }}
        >
          {devices.map(device => (
            <DeviceCard
              key={`${device.node}-${slotKeyFromDevice(device)}-${device.slot_id}`}
              device={device}
              slot={getSlotForDevice(device)}
              telemetryHistory={telemetryHistory}
            />
          ))}
        </Box>
      ) : (
        <Paper sx={{ p: 4, textAlign: 'center', mb: 3 }}>
          <Typography color="text.secondary">{noDevicesMessage}</Typography>
        </Paper>
      )}

      {/* TPS Comparison Chart */}
      {devices.length > 0 && (
        <Paper sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>
            Current TPS by Device — Higher is Better
          </Typography>
          <BarChart
            xAxis={[{ scaleType: 'band', data: chartLabels }]}
            series={[{ data: chartTps, label: 'TPS', color: headerChip }]}
            colors={chartColors}
            height={280}
          />
        </Paper>
      )}

      {/* Live Slots Table — R1: rendered from typeSlots (device-type-filtered).
          R2: row key includes slot_id to avoid collisions for multi-slot nodes. */}
      {typeSlots.length > 0 && (
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>
            Active Exam Slots
          </Typography>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Device</TableCell>
                  <TableCell>Node</TableCell>
                  <TableCell>Exam</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">TPS</TableCell>
                  <TableCell align="right">TT100T (s)</TableCell>
                  <TableCell align="right">Elapsed</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {typeSlots.map(slot => (
                  <TableRow key={`${slot.node}-${slot.slot_id}`} hover>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box
                          sx={{
                            width: 10,
                            height: 10,
                            borderRadius: '50%',
                            bgcolor: getDeviceColor(slot.gpu_type),
                            flexShrink: 0
                          }}
                        />
                        {slot.gpu_type.replace(/^NVIDIA-/, '')}
                      </Box>
                    </TableCell>
                    <TableCell>{slot.node}</TableCell>
                    <TableCell
                      sx={{
                        maxWidth: 200,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {slot.exam_name ?? (slot.exam_id != null ? `#${slot.exam_id}` : '—')}
                    </TableCell>
                    <TableCell>
                      <StatusChip status={slot.status} />
                    </TableCell>
                    <TableCell align="right">
                      {slot.tps != null ? slot.tps.toFixed(2) : '—'}
                    </TableCell>
                    <TableCell align="right">
                      {slot.tt100t != null ? (
                        <Box
                          component="span"
                          sx={{
                            color: slot.tt100t < 1.1 ? 'success.main' : 'text.primary',
                            fontWeight: 600
                          }}
                        >
                          {slot.tt100t.toFixed(3)}
                        </Box>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell align="right">
                      {slot.elapsed_seconds != null ? `${slot.elapsed_seconds}s` : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {/* R1: empty-state also uses typeSlots so NPU/GPU dashboards don't
          falsely claim "no active exams" when the other type has running exams. */}
      {typeSlots.length === 0 && devices.length > 0 && !error && (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">
            {connected
              ? `No active ${deviceType === 'all' ? 'device' : deviceType.toUpperCase()} exams. Start a sweep or submit an exam.`
              : 'Connecting to realtime feed…'}
          </Typography>
        </Paper>
      )}
    </Box>
  );
};
