import { Box, Chip, Typography } from '@mui/material';

type Props = {
  title: string;
  description: string;
  chipLabel?: string;
  chipColor?: string;
};

export const DeviceDashboardHeader = ({ title, description, chipLabel, chipColor = '#4F46E5' }: Props) => (
  <Box sx={{ mb: 3 }}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.75 }}>
      <Typography variant="h5" component="h1" fontWeight={700}>
        {title}
      </Typography>
      {chipLabel && (
        <Chip
          label={chipLabel}
          size="small"
          sx={{ bgcolor: chipColor, color: '#fff', fontWeight: 600, fontSize: '0.6875rem' }}
        />
      )}
    </Box>
    <Typography variant="body2" color="text.secondary">
      {description}
    </Typography>
  </Box>
);
