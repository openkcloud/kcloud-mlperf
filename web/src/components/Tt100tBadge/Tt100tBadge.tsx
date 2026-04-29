import { Chip, Tooltip } from '@mui/material';

const TT100T_THRESHOLD = 1.1;

type KpiStatus = 'pass' | 'fail' | 'unknown';

const STATUS_COLORS: Record<KpiStatus, { bg: string; text: string; label: string }> = {
  pass: { bg: '#16A34A', text: '#fff', label: 'PASS' },
  fail: { bg: '#DC2626', text: '#fff', label: 'FAIL' },
  unknown: { bg: '#64748B', text: '#fff', label: '—' }
};

function resolveStatus(value: number | null | undefined): KpiStatus {
  if (value == null || !isFinite(value) || value <= 0) return 'unknown';
  return value < TT100T_THRESHOLD ? 'pass' : 'fail';
}

export type Tt100tBadgeProps = {
  /** TT100T value in seconds. null/undefined/non-finite renders grey UNKNOWN badge. */
  value: number | null | undefined;
  size?: 'small' | 'medium';
};

export const Tt100tBadge = ({ value, size = 'small' }: Tt100tBadgeProps) => {
  const status = resolveStatus(value);
  const cfg = STATUS_COLORS[status];

  const valueStr = value != null && isFinite(value) && value > 0 ? value.toFixed(3) : null;

  const tooltipLines =
    status === 'unknown'
      ? `TT100T: no data — threshold <${TT100T_THRESHOLD}s`
      : `TT100T: ${valueStr}s — threshold <${TT100T_THRESHOLD}s — ${cfg.label}`;

  const chipLabel = valueStr ? `TT100T ${valueStr}s` : `TT100T ${cfg.label}`;

  return (
    <Tooltip title={tooltipLines} arrow>
      <Chip
        label={chipLabel}
        size={size}
        sx={{
          bgcolor: cfg.bg,
          color: cfg.text,
          fontWeight: 700,
          fontSize: size === 'small' ? '0.6875rem' : '0.8125rem',
          letterSpacing: '0.01em',
          cursor: 'default'
        }}
      />
    </Tooltip>
  );
};
