import { Box, Paper, Typography, Alert, AlertTitle, Chip, Divider, Link } from '@mui/material';
import { Warning as WarningIcon, Memory as MemoryIcon, Extension as ExtensionIcon, Science as ScienceIcon, Storage as StorageIcon } from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';

import { DevicesApi } from '@/api/domains/devices.domains';
import { DevicesQueryKeys } from '@/contexts/QueryContext/query.keys';

// ----------------------------------------------------------------------

const BLOCKERS = [
  {
    Icon: ExtensionIcon,
    title: 'No upstream Rebellions Kubernetes device plugin',
    detail:
      'Rebellions has not released a production-grade device plugin for Kubernetes. Without it, the cluster scheduler cannot allocate RBLN-CA22 NPU resources to pods, so no inference workload can be scheduled on node5.',
  },
  {
    Icon: ScienceIcon,
    title: 'No inference framework deployed on node5',
    detail:
      'Unlike node4 which runs furiosa-llm, there is no RBLN-compatible inference framework (e.g. RBLN SDK serving stack) installed or containerised for node5. Benchmarks cannot execute without a functional serving layer.',
  },
  {
    Icon: StorageIcon,
    title: 'No benchmark profiles for Atom+',
    detail:
      'MLPerf, MMLU-Pro, and custom benchmark profiles have not been configured for the Rebellions Atom+ architecture. Dataset loaders, accuracy scripts, and result schemas must be adapted before any run can be submitted.',
  },
] as const;

// ----------------------------------------------------------------------

const HardwareIdentityCard = () => {
  const { data: deviceData } = useQuery({
    queryKey: DevicesQueryKeys.list(),
    queryFn: DevicesApi.list,
  });

  const rebellionsDevices = (Array.isArray(deviceData) ? deviceData : []).filter(
    (d: { vendor?: string }) => d.vendor?.toLowerCase() === 'rebellions'
  );

  return (
    <Paper
      sx={{
        p: 3,
        mb: 3,
        border: '1px solid rgba(234,179,8,0.3)',
        background: 'linear-gradient(135deg, rgba(234,179,8,0.04) 0%, rgba(251,191,36,0.02) 100%)',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2.5 }}>
        <MemoryIcon sx={{ color: '#CA8A04', fontSize: 28 }} />
        <Box>
          <Typography variant="h6" fontWeight={700} sx={{ color: '#0F172A', lineHeight: 1.2 }}>
            Hardware Identity
          </Typography>
          <Typography variant="caption" sx={{ color: '#64748B' }}>
            Physical device verified via rbln-smi on node5
          </Typography>
        </Box>
        <Box sx={{ ml: 'auto' }}>
          <Chip
            label="Hardware Present"
            size="small"
            sx={{
              bgcolor: 'rgba(22,163,74,0.1)',
              color: '#15803D',
              fontWeight: 600,
              border: '1px solid rgba(22,163,74,0.25)',
            }}
          />
        </Box>
      </Box>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 2,
        }}
      >
        {[
          { label: 'Vendor', value: 'Rebellions' },
          { label: 'Model', value: 'Atom+' },
          { label: 'Node', value: 'node5' },
          { label: 'NPU Count', value: '2' },
          { label: 'Device ID', value: 'RBLN-CA22' },
          { label: 'Discovery', value: 'rbln-smi' },
        ].map(({ label, value }) => (
          <Box key={label}>
            <Typography variant="caption" sx={{ color: '#94A3B8', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: '0.6rem' }}>
              {label}
            </Typography>
            <Typography variant="body2" fontWeight={700} sx={{ color: '#0F172A', mt: 0.25 }}>
              {value}
            </Typography>
          </Box>
        ))}
      </Box>

      {rebellionsDevices.length > 0 && (
        <>
          <Divider sx={{ my: 2 }} />
          <Typography variant="caption" sx={{ color: '#64748B', fontWeight: 600 }}>
            Live registry ({rebellionsDevices.length} device{rebellionsDevices.length !== 1 ? 's' : ''} returned from /api/devices)
          </Typography>
          {rebellionsDevices.map((d: { id?: number | string; vendor?: string; model?: string; node?: string }, i: number) => (
            <Box key={d.id ?? i} sx={{ mt: 0.75 }}>
              <Typography variant="caption" sx={{ color: '#475569', fontFamily: 'monospace' }}>
                vendor={d.vendor} model={d.model} node={d.node}
              </Typography>
            </Box>
          ))}
        </>
      )}
    </Paper>
  );
};

// ----------------------------------------------------------------------

const BlockerDiagnostic = () => (
  <Alert
    severity="warning"
    icon={<WarningIcon />}
    sx={{
      mb: 3,
      border: '1px solid rgba(234,179,8,0.4)',
      bgcolor: 'rgba(254,252,232,0.8)',
      '& .MuiAlert-icon': { color: '#CA8A04' },
    }}
  >
    <AlertTitle sx={{ fontWeight: 700, color: '#92400E', fontSize: '1rem' }}>
      Awaiting upstream Rebellions Kubernetes device plugin
    </AlertTitle>
    <Typography variant="body2" sx={{ color: '#78350F', mb: 2 }}>
      The Rebellions Atom+ NPU hardware is physically present and verified on node5, but three blockers must be
      resolved before any benchmark run can be scheduled or executed.
    </Typography>

    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {BLOCKERS.map(({ Icon, title, detail }, idx) => (
        <Box key={title} sx={{ display: 'flex', gap: 1.5 }}>
          <Box
            sx={{
              mt: 0.25,
              width: 28,
              height: 28,
              borderRadius: '50%',
              bgcolor: 'rgba(234,179,8,0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Typography sx={{ fontWeight: 800, fontSize: '0.75rem', color: '#92400E' }}>{idx + 1}</Typography>
          </Box>
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.25 }}>
              <Icon sx={{ fontSize: 16, color: '#B45309' }} />
              <Typography variant="body2" fontWeight={700} sx={{ color: '#78350F' }}>
                {title}
              </Typography>
            </Box>
            <Typography variant="caption" sx={{ color: '#92400E', lineHeight: 1.5 }}>
              {detail}
            </Typography>
          </Box>
        </Box>
      ))}
    </Box>

    <Divider sx={{ my: 2, borderColor: 'rgba(234,179,8,0.3)' }} />

    <Typography variant="caption" sx={{ color: '#78350F' }}>
      See the{' '}
      <Link
        href="/docs/node5_atomplus_runbook.md"
        target="_blank"
        rel="noopener noreferrer"
        sx={{ color: '#B45309', fontWeight: 600 }}
      >
        node5 Atom+ runbook
      </Link>
      {' '}for the full integration plan and resolution steps.
    </Typography>
  </Alert>
);

// ----------------------------------------------------------------------

const EmptyRunList = () => (
  <Paper
    sx={{
      p: 4,
      textAlign: 'center',
      border: '1px dashed rgba(148,163,184,0.4)',
      bgcolor: 'rgba(248,250,252,0.8)',
    }}
  >
    <MemoryIcon sx={{ fontSize: 48, color: '#CBD5E1', mb: 1.5 }} />
    <Typography variant="h6" fontWeight={600} sx={{ color: '#475569', mb: 0.75 }}>
      No Atom+ runs yet
    </Typography>
    <Typography variant="body2" sx={{ color: '#94A3B8', maxWidth: 480, mx: 'auto' }}>
      Once the Rebellions device plugin is deployed and the benchmark pipeline is operational on node5, completed
      and in-progress runs will appear here.
    </Typography>
  </Paper>
);

// ----------------------------------------------------------------------

const AtomPlusPage = () => (
  <Box>
    <Box sx={{ mb: 3 }}>
      <Typography variant="h5" fontWeight={700} sx={{ color: '#0F172A' }}>
        Rebellions Atom+ NPU Eval
      </Typography>
      <Typography variant="body2" sx={{ color: '#64748B', mt: 0.5 }}>
        node5 &mdash; RBLN-CA22 &times; 2 &mdash; Hardware present, runtime pending
      </Typography>
    </Box>

    <HardwareIdentityCard />
    <BlockerDiagnostic />
    <EmptyRunList />
  </Box>
);

export default AtomPlusPage;
