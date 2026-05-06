import { Box, Button, Chip, Typography } from '@mui/material';

type Action = {
  label: string;
  onClick: () => void;
  icon?: React.ReactNode;
  color?: string;
  borderColor?: string;
};

type Props = {
  title: string;
  subtitle?: string;
  vendorBadgeLabel: string;
  vendorColor: string;
  actions?: Action[];
  onPrimary?: { label: string; onClick: () => void; active?: boolean; activeLabel?: string };
  children: React.ReactNode;
};

export const BenchmarkPageShell = ({
  title,
  subtitle,
  vendorBadgeLabel,
  vendorColor,
  actions = [],
  onPrimary,
  children,
}: Props) => (
  <Box>
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5 }}>
          <Typography variant="h5" fontWeight={700}>{title}</Typography>
          <Chip
            label={vendorBadgeLabel}
            size="small"
            sx={{
              bgcolor: `rgba(${hexToRgb(vendorColor)},0.12)`,
              color: vendorColor,
              fontWeight: 700,
              border: `1px solid rgba(${hexToRgb(vendorColor)},0.3)`,
            }}
          />
        </Box>
        {actions.length > 0 && (
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 0.5 }}>
            {actions.map((a) => (
              <Button
                key={a.label}
                variant="outlined"
                size="small"
                sx={{ color: a.color ?? vendorColor, borderColor: a.borderColor ?? a.color ?? vendorColor }}
                onClick={a.onClick}
              >
                {a.icon}
                {a.label}
              </Button>
            ))}
          </Box>
        )}
        {subtitle && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {subtitle}
          </Typography>
        )}
      </Box>
      {onPrimary && (
        <Button variant="contained" onClick={onPrimary.onClick}>
          {onPrimary.active && onPrimary.activeLabel ? onPrimary.activeLabel : onPrimary.label}
        </Button>
      )}
    </Box>
    {children}
  </Box>
);

function hexToRgb(hex: string): string {
  const h = hex.replace('#', '');
  const n = parseInt(h, 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}
