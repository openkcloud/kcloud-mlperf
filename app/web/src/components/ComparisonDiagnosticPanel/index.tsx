import {
  Button,
  Paper,
  Typography
} from '@mui/material';
import {
  ErrorOutline,
  FilterAltOff,
  HardwareOutlined,
  PlayCircleOutline
} from '@mui/icons-material';

import type { ComparisonDiagnosticReason } from '@/api/domains/comparison';

// ----------------------------------------------------------------------

type DiagnosticConfig = {
  icon: React.ReactNode;
  title: string;
  body: string;
  buttonLabel: string;
};

const DIAGNOSTIC_MAP: Record<ComparisonDiagnosticReason, DiagnosticConfig> = {
  no_runs_exist: {
    icon: <PlayCircleOutline sx={{ fontSize: 48, color: 'text.disabled' }} />,
    title: 'No runs exist yet',
    body: 'No benchmark runs have been submitted. Start a new exam to generate comparison data.',
    buttonLabel: 'Start a new run'
  },
  all_runs_filtered: {
    icon: <FilterAltOff sx={{ fontSize: 48, color: 'warning.main' }} />,
    title: 'All runs filtered out',
    body: 'Runs exist but the current filter combination excludes all of them. Try clearing your filters.',
    buttonLabel: 'Clear filters'
  },
  ingestion_failed: {
    icon: <ErrorOutline sx={{ fontSize: 48, color: 'error.main' }} />,
    title: 'Data ingestion error',
    body: 'One or more runs completed but their results could not be ingested. Check the artifacts log.',
    buttonLabel: 'Open artifacts'
  },
  hardware_not_ready: {
    icon: <HardwareOutlined sx={{ fontSize: 48, color: 'text.disabled' }} />,
    title: 'Hardware not ready',
    body: 'The target hardware node is unavailable or not yet registered in the cluster.',
    buttonLabel: 'View cluster status'
  }
};

// ----------------------------------------------------------------------

type Props = {
  reason: ComparisonDiagnosticReason;
  message?: string;
  onAction?: () => void;
  'data-testid'?: string;
};

export const ComparisonDiagnosticPanel = ({
  reason,
  message,
  onAction,
  'data-testid': testId
}: Props) => {
  const config = DIAGNOSTIC_MAP[reason];

  return (
    <Paper
      data-testid={testId ?? 'comparison-diagnostic-panel'}
      data-reason={reason}
      sx={{
        py: 6,
        px: 4,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: 2,
        border: '1px dashed',
        borderColor: 'divider',
        background: 'transparent'
      }}
      elevation={0}
    >
      {config.icon}
      <Typography variant="h6" fontWeight={700}>
        {config.title}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420 }}>
        {message ?? config.body}
      </Typography>
      {onAction && (
        <Button variant="outlined" size="small" onClick={onAction} sx={{ mt: 1 }}>
          {config.buttonLabel}
        </Button>
      )}
    </Paper>
  );
};
