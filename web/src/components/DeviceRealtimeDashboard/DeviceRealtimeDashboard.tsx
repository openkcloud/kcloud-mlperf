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
  Typography
} from '@mui/material';
import { BarChart } from '@mui/x-charts/BarChart';

import type { DeviceEntry, DeviceState, DeviceVendor } from '@/api/types/devices.types';
import { DeviceDashboardHeader } from '@/components/DeviceDashboardHeader';
import { DEVICE_COLORS, getDeviceColor, getVendorColor } from '@/constants/device-colors';

import { deviceLabel, slotKeyFromDevice, useDeviceRegistry } from '@/hooks/useDeviceRegistry';
import { useRealtimeExams } from '@/hooks/useRealtimeExams';
import type { RealtimeExamSlot } from '@/hooks/useRealtimeExams';

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

const STATE_CHIP: Record<DeviceState, { label: string; color: string }> = {
  ready: { label: 'Ready', color: '#16A34A' },
  pending_join: { label: 'Pending Join', color: '#D97706' },
  not_ready: { label: 'Not Ready', color: '#DC2626' },
  degraded: { label: 'Degraded', color: '#EA580C' },
  unknown: { label: 'Unknown', color: '#64748B' }
};

// -----------------------------------------------------------------------

type StatusChipProps = { status: string };

const StatusChip = ({ status }: StatusChipProps) => {
  const map: Record<string, { label: string; color: string }> = {
    Running: { label: 'Running', color: '#16A34A' },
    running: { label: 'Running', color: '#16A34A' },
    Completed: { label: 'Completed', color: '#4F46E5' },
    Pending: { label: 'Pending', color: '#D97706' },
    Preparing: { label: 'Preparing', color: '#0284C7' },
    preparing: { label: 'Preparing', color: '#0284C7' },
    Idle: { label: 'Idle', color: '#64748B' },
    idle: { label: 'Idle', color: '#64748B' },
    Failed: { label: 'Failed', color: '#DC2626' },
    error: { label: 'Error', color: '#DC2626' },
    Stopped: { label: 'Stopped', color: '#9333EA' }
  };
  const cfg = map[status] ?? { label: status, color: '#64748B' };
  return (
    <Chip
      label={cfg.label}
      size="small"
      sx={{ bgcolor: cfg.color, color: '#fff', fontWeight: 600, fontSize: '0.6875rem' }}
    />
  );
};

const RegistryStateChip = ({ state }: { state: DeviceState }) => {
  const cfg = STATE_CHIP[state] ?? STATE_CHIP.unknown;
  return (
    <Chip
      label={cfg.label}
      size="small"
      variant="outlined"
      sx={{
        borderColor: cfg.color,
        color: cfg.color,
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
};

const DeviceCard = ({ device, slot }: DeviceCardProps) => {
  const slotKey = slotKeyFromDevice(device);
  const color = getDeviceColor(slotKey);
  const vendorColor = getVendorColor(VENDOR_DISPLAY[device.vendor] ?? device.vendor);
  const status = slot?.status ?? (device.state === 'ready' ? 'Idle' : 'Pending');
  const isRunning = status.toLowerCase() === 'running';
  const badgeText = device.type === 'npu' ? 'NPU' : device.type === 'cpu' ? 'CPU' : 'GPU';
  const label = deviceLabel(device);
  const isPending = device.state === 'pending_join' || device.k8s_node_status === 'Absent';

  return (
    <Paper
      sx={{ p: 2.5, borderTop: `3px solid ${color}`, height: '100%', opacity: isPending ? 0.7 : 1 }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
        <Box
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

      {isPending && (
        <Typography
          variant="caption"
          sx={{ mt: 1.5, display: 'block', color: STATE_CHIP.pending_join.color, fontWeight: 600 }}
        >
          Awaiting cluster join — slot reserved.
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
  const {
    devices,
    health,
    isLoading: registryLoading,
    error: registryError
  } = useDeviceRegistry({ deviceType });
  const { snapshot, connected, error } = useRealtimeExams();

  const allSlots = snapshot?.slots ?? [];
  const progress = snapshot?.sweep_progress ?? { completed: 0, total: 96, paused: true };
  const raceAlerts = snapshot?.operator_race_alerts ?? 0;

  const slots = benchmarkFilter
    ? allSlots.filter(
        s =>
          s.exam_name != null && s.exam_name.toLowerCase().includes(benchmarkFilter.toLowerCase())
      )
    : allSlots;

  const getSlotForDevice = (device: DeviceEntry): RealtimeExamSlot | null => {
    const key = slotKeyFromDevice(device);
    return slots.find(s => s.gpu_type === key) ?? null;
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
              borderColor: health.source_used === 'k8s' ? '#16A34A' : '#D97706',
              color: health.source_used === 'k8s' ? '#16A34A' : '#D97706'
            }}
          />
          <Chip
            label={health.k8s_api_reachable ? 'k8s API: Reachable' : 'k8s API: Unreachable'}
            size="small"
            variant="outlined"
            sx={{
              fontSize: '0.6875rem',
              borderColor: health.k8s_api_reachable ? '#16A34A' : '#DC2626',
              color: health.k8s_api_reachable ? '#16A34A' : '#DC2626'
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

      {/* Live Slots Table */}
      {slots.length > 0 && (
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
                {slots.map(slot => (
                  <TableRow key={`${slot.gpu_type}-${slot.node}`} hover>
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

      {slots.length === 0 && devices.length > 0 && !error && (
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
