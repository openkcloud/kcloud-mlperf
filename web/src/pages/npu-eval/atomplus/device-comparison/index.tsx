import { Box, Paper, Typography } from '@mui/material';
import { Memory as MemoryIcon } from '@mui/icons-material';

// ----------------------------------------------------------------------

const AtomPlusDeviceComparison = () => (
  <Box>
    <Box sx={{ mb: 3 }}>
      <Typography variant="h5" fontWeight={700} sx={{ color: '#0F172A' }}>
        Atom+ Device Comparison
      </Typography>
      <Typography variant="body2" sx={{ color: '#64748B', mt: 0.5 }}>
        Rebellions Atom+ vs other devices &mdash; pending runtime deployment
      </Typography>
    </Box>

    <Paper
      sx={{
        p: 5,
        textAlign: 'center',
        border: '1px dashed rgba(148,163,184,0.4)',
        bgcolor: 'rgba(248,250,252,0.8)',
      }}
    >
      <MemoryIcon sx={{ fontSize: 56, color: '#CBD5E1', mb: 2 }} />
      <Typography variant="h6" fontWeight={600} sx={{ color: '#475569', mb: 1.5 }}>
        No Atom+ runs yet
      </Typography>
      <Typography variant="body2" sx={{ color: '#94A3B8', maxWidth: 560, mx: 'auto', lineHeight: 1.7 }}>
        Once the Rebellions device plugin and benchmark pipeline are deployed on node5, comparable runs will appear
        here. Three blockers currently prevent any benchmark execution:
      </Typography>
      <Box
        component="ol"
        sx={{
          mt: 2,
          mb: 0,
          textAlign: 'left',
          display: 'inline-block',
          color: '#64748B',
          fontSize: '0.875rem',
          lineHeight: 1.8,
          pl: 3,
        }}
      >
        <li>No upstream Rebellions Kubernetes device plugin &mdash; NPU resources cannot be scheduled by the cluster.</li>
        <li>No inference framework deployed &mdash; there is no RBLN-compatible serving stack on node5.</li>
        <li>No benchmark profiles for Atom+ &mdash; MLPerf and MMLU-Pro profiles have not been adapted for the RBLN-CA22 architecture.</li>
      </Box>
    </Paper>
  </Box>
);

export default AtomPlusDeviceComparison;
