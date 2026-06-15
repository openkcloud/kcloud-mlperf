import { memo } from 'react';

import { MpExamStatusProgressBar } from './ExamStatusProgressBar';
import { Chip } from '@mui/material';

import type { StatusEnum } from '@/enums/status.enum.ts';

// ----------------------------------------------------------------------

type ExamStatusBadgeProps = {
  status: StatusEnum;
  id: number;
  tablePageNumber: number;
};

type StatusBadgeVariant = 'success' | 'danger' | 'warning' | 'info' | 'progress';

// ----------------------------------------------------------------------

const badgeStatusMap: Record<StatusEnum, { text: string; variant: StatusBadgeVariant }> = {
  Idle: {
    text: 'waiting',
    variant: 'info'
  },
  Pending: {
    text: 'pending',
    variant: 'progress'
  },
  Preparing: {
    text: 'preparing',
    variant: 'progress'
  },
  Undefined: {
    text: 'undefined',
    variant: 'progress'
  },
  Running: {
    text: 'running',
    variant: 'progress'
  },
  Completed: {
    text: 'completed',
    variant: 'success'
  },
  Terminating: {
    text: 'halt',
    variant: 'warning'
  },
  Error: {
    text: 'error',
    variant: 'danger'
  },
  Stopped: {
    text: 'stopped',
    variant: 'warning'
  }
};

// Color-coded chip styles per variant
const chipStyles = {
  success: {
    bgcolor: '#ECFDF5',
    color: '#065F46',
    border: '1px solid #A7F3D0',
    fontWeight: 600,
    fontSize: '0.6875rem',
    textTransform: 'uppercase' as const
  },
  danger: {
    bgcolor: '#FEF2F2',
    color: '#991B1B',
    border: '1px solid #FECACA',
    fontWeight: 600,
    fontSize: '0.6875rem',
    textTransform: 'uppercase' as const
  },
  warning: {
    bgcolor: '#FFFBEB',
    color: '#92400E',
    border: '1px solid #FDE68A',
    fontWeight: 600,
    fontSize: '0.6875rem',
    textTransform: 'uppercase' as const
  },
  info: {
    bgcolor: '#EEF2FF',
    color: '#3730A3',
    border: '1px solid #C7D2FE',
    fontWeight: 600,
    fontSize: '0.6875rem',
    textTransform: 'uppercase' as const
  }
};

// ----------------------------------------------------------------------

export const ExamStatusBadge = memo<ExamStatusBadgeProps>(props => {
  const { status, ...rest } = props;

  const { text, variant } = badgeStatusMap[status];

  switch (variant) {
    case 'success':
      return <Chip size="small" label={text} sx={chipStyles.success} />;

    case 'progress':
      return <MpExamStatusProgressBar status={status} {...rest} />;

    case 'danger':
      return <Chip size="small" label={text} sx={chipStyles.danger} />;

    case 'warning':
      return <Chip size="small" label={text} sx={chipStyles.warning} />;

    default:
      return <Chip size="small" label={text} sx={chipStyles.info} />;
  }
});
