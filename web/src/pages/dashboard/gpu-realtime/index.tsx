import { useState } from 'react';
import { Box, Chip, Paper, Typography } from '@mui/material';

// ---------------------------------------------------------------------------
// URL construction — env-aware
// ---------------------------------------------------------------------------

/**
 * Returns the configured GPU Prometheus/Grafana URL, or empty string if unset.
 * Set VITE__APP_GPU_PROMETHEUS_URL in .env / ConfigMap to activate the iframe.
 */
export function getGpuPrometheusUrl(): string {
  return (import.meta.env.VITE__APP_GPU_PROMETHEUS_URL as string | undefined) ?? '';
}

type DashboardState = 'loading' | 'ready' | 'error' | 'unavailable';

/**
 * Maps the configured URL and an optional fetch/load error to a display state.
 * NEVER returns 'ready' when the URL is empty — that would show a broken iframe.
 */
export function deriveState(url: string, loadError: boolean): DashboardState {
  if (!url) return 'unavailable';
  if (loadError) return 'error';
  return 'ready';
}

// ---------------------------------------------------------------------------

const UNAVAILABLE_MESSAGE =
  'Prometheus unavailable — install kube-prometheus-stack and set VITE__APP_GPU_PROMETHEUS_URL';

const GpuRealtimePage = () => {
  const url = getGpuPrometheusUrl();
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
    <Paper sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="h6">Live GPU Dashboard</Typography>
          {state === 'ready' && (
            <Chip
              label="Live"
              size="small"
              sx={{ bgcolor: '#16A34A', color: '#fff', fontWeight: 600 }}
            />
          )}
          {state === 'loading' && (
            <Chip
              label="Connecting…"
              size="small"
              sx={{ bgcolor: '#D97706', color: '#fff', fontWeight: 600 }}
            />
          )}
          {state === 'unavailable' && (
            <Chip
              label="Unavailable"
              size="small"
              sx={{ bgcolor: '#64748B', color: '#fff', fontWeight: 600 }}
            />
          )}
          {state === 'error' && (
            <Chip
              label="Error"
              size="small"
              sx={{ bgcolor: '#DC2626', color: '#fff', fontWeight: 600 }}
            />
          )}
        </Box>
        {url && (
          <Typography variant="caption">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#3aa3ff', textDecoration: 'none' }}
            >
              open in new tab ↗
            </a>
          </Typography>
        )}
      </Box>

      {(state === 'unavailable') && (
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
            p: 3
          }}
        >
          <Typography sx={{ color: '#64748B', fontSize: '2rem' }}>📊</Typography>
          <Typography
            variant="body1"
            sx={{ color: '#94A3B8', textAlign: 'center', maxWidth: 480, fontWeight: 500 }}
          >
            {UNAVAILABLE_MESSAGE}
          </Typography>
          <Typography variant="caption" sx={{ color: '#475569', textAlign: 'center' }}>
            Once deployed, set{' '}
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
            p: 3
          }}
        >
          <Typography
            variant="body1"
            sx={{ color: '#F87171', textAlign: 'center', maxWidth: 480, fontWeight: 500 }}
          >
            Failed to load GPU dashboard from {url}
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
                zIndex: 1
              }}
            >
              <Typography sx={{ color: '#94A3B8' }}>Loading dashboard…</Typography>
            </Box>
          )}
          <Box
            component="iframe"
            src={url}
            title="GPU realtime Prometheus dashboard"
            onLoad={() => setLoaded(true)}
            onError={() => setLoadError(true)}
            sx={{
              width: '100%',
              height: 700,
              border: 0,
              borderRadius: 1,
              bgcolor: '#0e1117',
              display: 'block',
              opacity: state === 'ready' ? 1 : 0
            }}
          />
        </Box>
      )}
    </Paper>
  );
};

export default GpuRealtimePage;
