import { Box, Chip, LinearProgress, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { BarChart } from '@mui/x-charts/BarChart';

import { DeviceDashboardHeader } from '@/components/DeviceDashboardHeader';
import { DEVICE_COLORS, getDeviceColor } from '@/constants/device-colors';
import { useRealtimeExams } from '@/hooks/useRealtimeExams';
import type { RealtimeExamSlot } from '@/hooks/useRealtimeExams';

// -----------------------------------------------------------------------

const GPU_SKUS = ['NVIDIA-L40', 'NVIDIA-A40', 'NVIDIA-L40-44GiB', 'NVIDIA-A40-44GiB'] as const;

type StatusChipProps = { status: string };

const StatusChip = ({ status }: StatusChipProps) => {
  const map: Record<string, { label: string; color: string }> = {
    Running: { label: 'Running', color: '#16A34A' },
    Completed: { label: 'Completed', color: '#4F46E5' },
    Pending: { label: 'Pending', color: '#D97706' },
    Preparing: { label: 'Preparing', color: '#0284C7' },
    Idle: { label: 'Idle', color: '#64748B' },
    Failed: { label: 'Failed', color: '#DC2626' },
    Stopped: { label: 'Stopped', color: '#9333EA' },
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

// -----------------------------------------------------------------------

type DeviceCardProps = {
  gpuType: string;
  slot: RealtimeExamSlot | null;
};

const DeviceCard = ({ gpuType, slot }: DeviceCardProps) => {
  const color = getDeviceColor(gpuType);
  const status = slot?.status ?? 'Idle';
  const isRunning = status === 'Running';

  return (
    <Paper sx={{ p: 2.5, borderTop: `3px solid ${color}`, height: '100%' }}>
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
            flexShrink: 0,
          }}
        >
          GPU
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography fontWeight={700} fontSize="0.875rem" noWrap>
            {gpuType}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap>
            {slot?.node ?? '—'}
          </Typography>
        </Box>
        <StatusChip status={status} />
      </Box>

      {isRunning && (
        <LinearProgress
          variant="indeterminate"
          sx={{ mb: 1.5, borderRadius: 1, height: 4, bgcolor: `${color}22`, '& .MuiLinearProgress-bar': { bgcolor: color } }}
        />
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
        <Box>
          <Typography variant="caption" color="text.secondary">Exam ID</Typography>
          <Typography fontSize="0.8125rem" fontWeight={600}>{slot?.exam_id ?? '—'}</Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">Elapsed</Typography>
          <Typography fontSize="0.8125rem" fontWeight={600}>
            {slot?.elapsed_seconds != null ? `${slot.elapsed_seconds}s` : '—'}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">TPS</Typography>
          <Typography fontSize="0.8125rem" fontWeight={600}>
            {slot?.tps != null ? slot.tps.toFixed(2) : '—'}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">TT100T (s)</Typography>
          <Typography fontSize="0.8125rem" fontWeight={600}>
            {slot?.tt100t != null ? slot.tt100t.toFixed(3) : '—'}
          </Typography>
        </Box>
      </Box>

      {slot?.exam_name && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ mt: 1.5, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {slot.exam_name}
        </Typography>
      )}
    </Paper>
  );
};

// -----------------------------------------------------------------------

type Props = {
  /** Optional benchmark filter ('mlperf' | 'mmlu' | undefined = all) */
  benchmarkFilter?: string;
};

export const DeviceRealtimeDashboard = ({ benchmarkFilter }: Props) => {
  const { snapshot, connected, error } = useRealtimeExams();

  const allSlots = snapshot?.slots ?? [];
  const progress = snapshot?.sweep_progress ?? { completed: 0, total: 96, paused: true };
  const raceAlerts = snapshot?.operator_race_alerts ?? 0;

  // Filter slots by benchmark type when a filter is active.
  // Slots are matched by exam_name containing the benchmark keyword (case-insensitive).
  const slots = benchmarkFilter
    ? allSlots.filter(s =>
        s.exam_name != null && s.exam_name.toLowerCase().includes(benchmarkFilter.toLowerCase())
      )
    : allSlots;

  const getSlot = (gpuType: string): RealtimeExamSlot | null =>
    slots.find(s => s.gpu_type === gpuType) ?? null;

  // Build BarChart series from the latest TPS of each GPU
  const chartLabels = GPU_SKUS.map(g => g.replace('NVIDIA-', ''));
  const chartTps = GPU_SKUS.map(g => getSlot(g)?.tps ?? 0);
  const chartColors = GPU_SKUS.map(g => getDeviceColor(g));

  const progressPct = progress.total > 0 ? (progress.completed / progress.total) * 100 : 0;

  return (
    <Box>
      <DeviceDashboardHeader
        title="GPU Real-Time Dashboard"
        description="Live benchmark status across all GPU nodes. Mirrors the NPU evaluation dashboard."
        chipLabel="Live"
        chipColor={DEVICE_COLORS.GPU}
      />

      {/* Connection status banners */}
      {error && (
        <Box sx={{ mb: 2, p: 1.5, bgcolor: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.25)', borderRadius: 1 }}>
          <Typography variant="body2" color="warning.main">{error}</Typography>
        </Box>
      )}
      {raceAlerts > 0 && (
        <Box sx={{ mb: 2, p: 1.5, bgcolor: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Chip label={`${raceAlerts} operator race alert${raceAlerts > 1 ? 's' : ''}`} size="small" color="error" />
          <Typography variant="body2" color="error.main">Cells will auto-requeue with stagger.</Typography>
        </Box>
      )}

      {/* Sweep progress */}
      <Paper sx={{ p: 2.5, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Typography fontWeight={600} fontSize="0.9375rem">
            Sweep Progress
            {benchmarkFilter && (
              <Chip label={benchmarkFilter.toUpperCase()} size="small" variant="outlined" sx={{ ml: 1 }} />
            )}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {progress.paused && <Chip label="Paused" size="small" sx={{ bgcolor: '#64748B', color: '#fff' }} />}
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
          sx={{ height: 8, borderRadius: 4, bgcolor: 'rgba(79,70,229,0.12)', '& .MuiLinearProgress-bar': { bgcolor: DEVICE_COLORS.GPU } }}
        />
      </Paper>

      {/* Device Cards */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', xl: 'repeat(4, 1fr)' }, gap: 2.5, mb: 3 }}>
        {GPU_SKUS.map(gpuType => (
          <DeviceCard key={gpuType} gpuType={gpuType} slot={getSlot(gpuType)} />
        ))}
      </Box>

      {/* TPS Comparison Chart */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Current TPS by GPU — Higher is Better
        </Typography>
        <BarChart
          xAxis={[{ scaleType: 'band', data: chartLabels }]}
          series={[{ data: chartTps, label: 'TPS', color: DEVICE_COLORS.GPU }]}
          colors={chartColors}
          height={280}
        />
      </Paper>

      {/* Live Slots Table */}
      {slots.length > 0 && (
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>Active Exam Slots</Typography>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>GPU</TableCell>
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
                  <TableRow key={slot.gpu_type} hover>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: getDeviceColor(slot.gpu_type), flexShrink: 0 }} />
                        {slot.gpu_type.replace('NVIDIA-', '')}
                      </Box>
                    </TableCell>
                    <TableCell>{slot.node}</TableCell>
                    <TableCell sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {slot.exam_name ?? (slot.exam_id != null ? `#${slot.exam_id}` : '—')}
                    </TableCell>
                    <TableCell><StatusChip status={slot.status} /></TableCell>
                    <TableCell align="right">{slot.tps != null ? slot.tps.toFixed(2) : '—'}</TableCell>
                    <TableCell align="right">
                      {slot.tt100t != null ? (
                        <Box component="span" sx={{ color: slot.tt100t < 1.1 ? 'success.main' : 'text.primary', fontWeight: 600 }}>
                          {slot.tt100t.toFixed(3)}
                        </Box>
                      ) : '—'}
                    </TableCell>
                    <TableCell align="right">{slot.elapsed_seconds != null ? `${slot.elapsed_seconds}s` : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {slots.length === 0 && !error && (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">
            {connected
              ? 'No active GPU exams. Start a sweep or submit an exam from the MLPerf / MMLU pages.'
              : 'Connecting to realtime feed…'}
          </Typography>
        </Paper>
      )}
    </Box>
  );
};
