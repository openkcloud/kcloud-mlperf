import { Box, Chip, Paper, Typography } from '@mui/material';

type Field = { label: string; value: string };

type Props = {
  vendor: string;
  model: string;
  node: string;
  count: string | number;
  deviceId?: string;
  devices?: Field[];
  vendorColor?: string;
  extraInfo?: string;
  badgeLabel?: string;
};

export const HardwareIdentityCard = ({
  vendor,
  model,
  node,
  count,
  deviceId,
  devices,
  vendorColor = '#F97316',
  extraInfo,
  badgeLabel,
}: Props) => {
  const rgb = hexToRgb(vendorColor);
  return (
    <Paper
      sx={{
        p: 2,
        mb: 3,
        border: `1px solid rgba(${rgb},0.25)`,
        bgcolor: `rgba(${rgb},0.03)`,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ color: vendorColor }}>
            Hardware Identity
          </Typography>
          <Typography variant="body2">
            Vendor: {vendor} &nbsp;|&nbsp; Model: {model} &nbsp;|&nbsp; Node: {node} &nbsp;|&nbsp; Count: {count}
            {deviceId ? <> &nbsp;|&nbsp; ID: {deviceId}</> : null}
          </Typography>
          {extraInfo && (
            <Typography variant="caption" color="text.secondary">
              {extraInfo}
            </Typography>
          )}
          {devices && devices.length > 0 && (
            <Box sx={{ mt: 1, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              {devices.map(({ label, value }) => (
                <Box key={label}>
                  <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.6rem' }}>
                    {label}
                  </Typography>
                  <Typography variant="body2" fontWeight={600} sx={{ mt: 0.25 }}>
                    {value}
                  </Typography>
                </Box>
              ))}
            </Box>
          )}
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
  );
};

function hexToRgb(hex: string): string {
  const h = hex.replace('#', '');
  const n = parseInt(h, 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}
