import { Box, Paper, Typography, Alert, AlertTitle, Chip, Divider, Link } from '@mui/material';
import { CheckCircle as CheckCircleIcon, Memory as MemoryIcon, Extension as ExtensionIcon, Science as ScienceIcon, Storage as StorageIcon } from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';

import { DevicesApi } from '@/api/domains/devices.domains';
import { DevicesQueryKeys } from '@/contexts/QueryContext/query.keys';

// ----------------------------------------------------------------------

// Atom+ readiness milestones (RUN_ID 20260429-071649-46d82f8 — see reports/atomplus_cluster_gap_fix_report.md).
const READINESS_ITEMS = [
  {
    Icon: ExtensionIcon,
    title: 'rbln-npu-operator v0.3.3 deployed',
    detail:
      'helm release rbln-system/rbln-npu-operator deployed. rbln-device-plugin DaemonSet running on node5; rebellions.ai/ATOM advertised as allocatable (count: 2). Host driver (kernel module rebellions 2.0.1) bypasses the in-cluster driver pod.',
  },
  {
    Icon: ScienceIcon,
    title: 'vllm-rbln + optimum-rbln runtime ready',
    detail:
      'node5 host has vllm 0.10.2, vllm_rbln 0.9.3.post2, optimum-rbln 0.9.3.post1, transformers 4.57.1, torch 2.8.0 (verified via pip3 list). Container image jungwooshim/etri-llm-rbln-smoke:v1 packages the same wheels for in-cluster Job execution.',
  },
  {
    Icon: StorageIcon,
    title: 'TT100T smoke benchmark PASSING',
    detail:
      'Qwen/Qwen2.5-0.5B-Instruct, 100 output tokens, mean 0.727s (target <1.1s), throughput ~137 tok/s, no invalid runs. See reports/atomplus_tt100t_analysis.md.',
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

const ReadinessSummary = () => (
  <Alert
    severity="success"
    icon={<CheckCircleIcon />}
    sx={{
      mb: 3,
      border: '1px solid rgba(22,163,74,0.4)',
      bgcolor: 'rgba(240,253,244,0.8)',
      '& .MuiAlert-icon': { color: '#15803D' },
    }}
  >
    <AlertTitle sx={{ fontWeight: 700, color: '#14532D', fontSize: '1rem' }}>
      Atom+ ready — runtime, scheduler, and TT100T benchmark all green
    </AlertTitle>
    <Typography variant="body2" sx={{ color: '#166534', mb: 2 }}>
      As of RUN_ID 20260429-071649-46d82f8, node5 Rebellions Atom+ is end-to-end operational: cluster scheduling
      works, the vllm-rbln runtime is in place, and the first measured TT100T smoke benchmark cleared the &lt;1.1s
      target.
    </Typography>

    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {READINESS_ITEMS.map(({ Icon, title, detail }, idx) => (
        <Box key={title} sx={{ display: 'flex', gap: 1.5 }}>
          <Box
            sx={{
              mt: 0.25,
              width: 28,
              height: 28,
              borderRadius: '50%',
              bgcolor: 'rgba(22,163,74,0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Typography sx={{ fontWeight: 800, fontSize: '0.75rem', color: '#14532D' }}>{idx + 1}</Typography>
          </Box>
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.25 }}>
              <Icon sx={{ fontSize: 16, color: '#15803D' }} />
              <Typography variant="body2" fontWeight={700} sx={{ color: '#14532D' }}>
                {title}
              </Typography>
            </Box>
            <Typography variant="caption" sx={{ color: '#166534', lineHeight: 1.5 }}>
              {detail}
            </Typography>
          </Box>
        </Box>
      ))}
    </Box>

    <Divider sx={{ my: 2, borderColor: 'rgba(22,163,74,0.3)' }} />

    <Typography variant="caption" sx={{ color: '#166534' }}>
      Cluster gap fix report:{' '}
      <Link
        href="/docs/node5_atomplus_runbook.md"
        target="_blank"
        rel="noopener noreferrer"
        sx={{ color: '#15803D', fontWeight: 600 }}
      >
        node5 Atom+ runbook
      </Link>
      {' '}— rerun + rollback recipes are recorded in reports/atomplus_cluster_gap_fix_report.md.
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

const LiveBenchDashboard = () => (
  <Paper sx={{ p: 2, mt: 3 }}>
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
      <Typography variant="h6">Live Bench Dashboard (node5 — Atom+)</Typography>
      <Typography variant="caption">
        <a
          href="http://10.254.177.41:30891/metrics"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#3aa3ff', textDecoration: 'none' }}
        >
          open Prometheus metrics in new tab ↗
        </a>
      </Typography>
    </Box>
    <Box
      component="iframe"
      src="http://10.254.177.41:30891/metrics"
      title="node5 Atom+ rbln-metrics-exporter"
      sx={{ width: '100%', height: 900, border: 0, borderRadius: 1, bgcolor: '#0e1117', display: 'block' }}
    />
  </Paper>
);

const AtomPlusPage = () => (
  <Box>
    <Box sx={{ mb: 3 }}>
      <Typography variant="h5" fontWeight={700} sx={{ color: '#0F172A' }}>
        Rebellions Atom+ NPU Eval
      </Typography>
      <Typography variant="body2" sx={{ color: '#64748B', mt: 0.5 }}>
        node5 &mdash; RBLN-CA22 &times; 2 &mdash; Ready, scheduler-allocatable, TT100T PASS
      </Typography>
    </Box>

    <HardwareIdentityCard />
    <ReadinessSummary />
    <EmptyRunList />
    <LiveBenchDashboard />
  </Box>
);

export default AtomPlusPage;
