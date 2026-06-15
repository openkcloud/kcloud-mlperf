import { useState } from 'react';
import { Box, Chip, Paper, Typography } from '@mui/material';

// ---------------------------------------------------------------------------
// Env-aware URL helper — exported for testing
// ---------------------------------------------------------------------------

export function getGpuPrometheusUrl(): string {
  return (import.meta.env.VITE__APP_GPU_PROMETHEUS_URL as string | undefined) ?? '';
}

export function getL40LiveBenchUrl(): string {
  // TODO: LAN-only fallback — set VITE__APP_L40_LIVE_BENCH_URL for external access
  return (
    (import.meta.env.VITE__APP_L40_LIVE_BENCH_URL as string | undefined) ??
    'http://10.254.184.195:30891/'
  );
}

export function getAtomPlusLiveBenchUrl(): string {
  // TODO: LAN-only fallback — set VITE__APP_ATOMPLUS_LIVE_BENCH_URL for external access
  return (
    (import.meta.env.VITE__APP_ATOMPLUS_LIVE_BENCH_URL as string | undefined) ??
    'http://10.254.202.111:30892/'
  );
}

export function getA40LiveBenchUrl(): string {
  // TODO: LAN-only fallback — set VITE__APP_A40_LIVE_BENCH_URL for external access
  return (
    (import.meta.env.VITE__APP_A40_LIVE_BENCH_URL as string | undefined) ??
    'http://10.254.184.196:30893/'
  );
}

export type DashboardState = 'loading' | 'ready' | 'error' | 'unavailable';

export function deriveState(url: string, loadError: boolean): DashboardState {
  if (!url) return 'unavailable';
  if (loadError) return 'error';
  return 'ready';
}

// ---------------------------------------------------------------------------

type Props = {
  title: string;
  src?: string;
  fallbackMessage?: string;
};

const DEFAULT_FALLBACK =
  'Prometheus URL not configured — set VITE__APP_GPU_PROMETHEUS_URL';

export const PrometheusIframeDashboard = ({
  title,
  src,
  fallbackMessage = DEFAULT_FALLBACK,
}: Props) => {
  const url = src ?? getGpuPrometheusUrl();
  const [loadError, setLoadError] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const state: DashboardState = !url
    ? 'unavailable'
    : loadError
    ? 'error'
    : loaded
    ? 'ready'
    : 'loading';

  return (
    <Paper sx={{ p: 2, mt: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="h6">{title}</Typography>
          {state === 'ready' && (
            <Chip label="Live" size="small" sx={{ bgcolor: '#16A34A', color: '#fff', fontWeight: 600, fontSize: '0.6875rem' }} />
          )}
          {state === 'loading' && (
            <Chip label="Connecting…" size="small" sx={{ bgcolor: '#D97706', color: '#fff', fontWeight: 600, fontSize: '0.6875rem' }} />
          )}
          {state === 'unavailable' && (
            <Chip label="Unavailable" size="small" sx={{ bgcolor: '#DC2626', color: '#fff', fontWeight: 600, fontSize: '0.6875rem', textDecoration: 'line-through' }} />
          )}
          {state === 'error' && (
            <Chip label="Error" size="small" sx={{ bgcolor: '#DC2626', color: '#fff', fontWeight: 600, fontSize: '0.6875rem' }} />
          )}
        </Box>
        {url && (
          <Typography variant="caption">
            <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: '#3aa3ff', textDecoration: 'none' }}>
              open in new tab ↗
            </a>
          </Typography>
        )}
      </Box>

      {state === 'unavailable' && (
        <Box
          sx={{
            height: 700,
            bgcolor: '#0e1117',
            borderRadius: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 2,
            p: 3,
          }}
        >
          <Typography sx={{ color: '#64748B', fontSize: '2rem' }}>📊</Typography>
          <Typography
            variant="body1"
            sx={{ color: '#EF4444', textAlign: 'center', maxWidth: 480, fontWeight: 500 }}
          >
            {fallbackMessage}
          </Typography>
          <Typography variant="caption" sx={{ color: '#475569', textAlign: 'center' }}>
            Set{' '}
            <Box
              component="code"
              sx={{ bgcolor: 'rgba(255,255,255,0.06)', px: 0.75, py: 0.25, borderRadius: 0.5 }}
            >
              VITE__APP_GPU_PROMETHEUS_URL
            </Box>{' '}
            to the Grafana/Prometheus NodePort URL (e.g. http://&lt;node-ip&gt;:30091/).
          </Typography>
        </Box>
      )}

      {state === 'error' && (
        <Box
          sx={{
            height: 700,
            bgcolor: '#0e1117',
            borderRadius: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 2,
            p: 3,
          }}
        >
          <Typography
            variant="body1"
            sx={{ color: '#F87171', textAlign: 'center', maxWidth: 480, fontWeight: 500 }}
          >
            Failed to load dashboard from {url}
          </Typography>
          <Typography variant="caption" sx={{ color: '#94A3B8' }}>
            Check that Prometheus / Grafana is reachable and CORS allows this origin.
          </Typography>
        </Box>
      )}

      {url && (state === 'loading' || state === 'ready') && (
        <Box sx={{ position: 'relative' }}>
          {state === 'loading' && (
            <Box
              sx={{
                position: 'absolute',
                inset: 0,
                height: 700,
                bgcolor: '#0e1117',
                borderRadius: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 1,
              }}
            >
              <Typography sx={{ color: '#94A3B8' }}>Loading dashboard…</Typography>
            </Box>
          )}
          <Box
            component="iframe"
            src={url}
            title={title}
            onLoad={() => setLoaded(true)}
            onError={() => setLoadError(true)}
            sx={{
              width: '100%',
              height: 700,
              border: 0,
              borderRadius: 1,
              bgcolor: '#0e1117',
              display: 'block',
              opacity: state === 'ready' ? 1 : 0,
            }}
          />
        </Box>
      )}
    </Paper>
  );
};
