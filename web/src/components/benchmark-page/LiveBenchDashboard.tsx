import { Box, Paper, Typography } from '@mui/material';

type Props = {
  title: string;
  src: string;
  height?: number;
};

export const LiveBenchDashboard = ({ title, src, height = 900 }: Props) => (
  <Paper sx={{ p: 2, mt: 3 }}>
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
      <Typography variant="h6">{title}</Typography>
      <Typography variant="caption">
        <a href={src} target="_blank" rel="noopener noreferrer" style={{ color: '#3aa3ff', textDecoration: 'none' }}>
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
);
