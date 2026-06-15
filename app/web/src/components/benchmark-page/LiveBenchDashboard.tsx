import { useState } from 'react';
import { Box, Chip, Paper, Typography, useTheme } from '@mui/material';

type Props = {
  title: string;
  src: string;
  height?: number;
  /** When true, renders an idle placeholder instead of the iframe. */
  idle?: boolean;
  /** Human-readable description shown in the idle placeholder. */
  idleLabel?: string;
};

export const LiveBenchDashboard = ({ title, src, height = 900, idle = false, idleLabel }: Props) => {
  const theme = useTheme();
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const state = idle ? 'idle' : loadError ? 'error' : loaded ? 'ready' : 'loading';

  // Link color: follow theme primary or a readable blue
  const linkColor = theme.palette.primary.main;

  return (
    <Paper sx={{ p: 2, mt: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="h6" component="h3">{title}</Typography>
          {state === 'ready' && (
            <Chip label="Live" size="small" sx={{ bgcolor: '#16A34A', color: '#fff', fontWeight: 600, fontSize: '0.6875rem' }} />
          )}
          {state === 'loading' && (
            <Chip label="Connecting…" size="small" sx={{ bgcolor: '#D97706', color: '#fff', fontWeight: 600, fontSize: '0.6875rem' }} />
          )}
          {state === 'idle' && (
            <Chip label="Idle" size="small" sx={{ bgcolor: '#475569', color: '#fff', fontWeight: 600, fontSize: '0.6875rem' }} />
          )}
          {state === 'error' && (
            <Chip label="Unavailable" size="small" sx={{ bgcolor: '#DC2626', color: '#fff', fontWeight: 600, fontSize: '0.6875rem' }} />
          )}
        </Box>
        {!idle && (
          <Typography variant="caption">
            <a href={src} target="_blank" rel="noopener noreferrer" style={{ color: linkColor, textDecoration: 'none' }}>
              open in new tab ↗
            </a>
          </Typography>
        )}
      </Box>

      {state === 'idle' && (
        <Box
          sx={{
            width: '100%',
            height,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: 'background.default',
            borderRadius: 1,
            gap: 2,
            p: 3,
          }}
        >
          <Typography sx={{ color: 'text.secondary', fontSize: '2rem' }}>⏸</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center', maxWidth: 480 }}>
            {idleLabel ?? 'No active run — no benchmark currently running on this device class'}
          </Typography>
        </Box>
      )}

      {state === 'error' && (
        <Box
          sx={{
            height,
            bgcolor: 'background.default',
            borderRadius: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 2,
            p: 3,
          }}
        >
          <Typography variant="body1" sx={{ color: 'error.main', textAlign: 'center', maxWidth: 480, fontWeight: 500 }}>
            Dashboard unavailable
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center', maxWidth: 480 }}>
            Could not load dashboard from {src}
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.disabled' }}>
            Check that the dashboard URL is reachable and CORS allows this origin.
          </Typography>
        </Box>
      )}

      {!idle && (
        <Box sx={{ position: 'relative' }}>
          {state === 'loading' && (
            <Box
              sx={{
                position: 'absolute',
                inset: 0,
                height,
                bgcolor: 'background.default',
                borderRadius: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 1,
              }}
            >
              <Typography sx={{ color: 'text.secondary' }}>Loading dashboard…</Typography>
            </Box>
          )}
          <Box
            component="iframe"
            src={src}
            title={title}
            onLoad={() => setLoaded(true)}
            onError={() => setLoadError(true)}
            sx={{
              width: '100%',
              height,
              border: 0,
              borderRadius: 1,
              // Keep the iframe background dark: Grafana dashboards are always dark-themed
              bgcolor: '#0e1117',
              display: state === 'error' ? 'none' : 'block',
              opacity: state === 'ready' ? 1 : 0,
            }}
          />
        </Box>
      )}
    </Paper>
  );
};
