import { memo, useState } from 'react';

import MoreVertIcon from '@mui/icons-material/MoreVert';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import StopRoundedIcon from '@mui/icons-material/StopRounded';
import AssessmentOutlinedIcon from '@mui/icons-material/AssessmentOutlined';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import { Box, Button, IconButton, Menu, MenuItem } from '@mui/material';

import { ErrorViewLog } from '@/components/Table/ErrorViewLog.tsx';
import { type StatusEnum } from '@/enums/status.enum.ts';

import { DeleteConfirmModal as MlperfDeleteConfirmModal } from '@/pages/mlperf/main/components/DeleteConfirmModal';
import { DeleteConfirmModal as MmluDeleteConfirmModal } from '@/pages/mmlu/main/components/DeleteConfirmModal';

// ----------------------------------------------------------------------

// Consistent button styles — all action buttons share the same width for alignment
const btnBase = {
  fontSize: '0.75rem',
  fontWeight: 600,
  height: 28,
  minWidth: 64,
  px: 1.5,
  borderRadius: '0.375rem',
  textTransform: 'none' as const,
  lineHeight: 1,
  whiteSpace: 'nowrap' as const
};

const btnStart = {
  ...btnBase,
  background: 'linear-gradient(135deg, #10B981 0%, #34D399 100%)',
  color: '#FFF',
  '&:hover': { background: 'linear-gradient(135deg, #059669 0%, #10B981 100%)' }
};

const btnStop = {
  ...btnBase,
  background: 'linear-gradient(135deg, #EF4444 0%, #F87171 100%)',
  color: '#FFF',
  '&:hover': { background: 'linear-gradient(135deg, #DC2626 0%, #EF4444 100%)' }
};

const btnResult = {
  ...btnBase,
  background: 'linear-gradient(135deg, #4F46E5 0%, #818CF8 100%)',
  color: '#FFF',
  '&:hover': { background: 'linear-gradient(135deg, #4338CA 0%, #4F46E5 100%)' }
};

const btnUseData = {
  ...btnBase,
  background: 'linear-gradient(135deg, #0EA5E9 0%, #38BDF8 100%)',
  color: '#FFF',
  '&:hover': { background: 'linear-gradient(135deg, #0284C7 0%, #0EA5E9 100%)' }
};

// ----------------------------------------------------------------------

type TableActionButtonProps = {
  status: StatusEnum;
  handleClickStartBtn: VoidFunction;
  handleClickStopBtn: VoidFunction;
  handleClickResetBtn: VoidFunction;
  handleClickDeleteBtn: VoidFunction;
  isLoading: boolean;
  errorLog?: string | null;
  examId: number;
  examName: string;
  deleteModalOpen: boolean;
  onCloseDeleteModal: VoidFunction;
  onUseData?: VoidFunction;
};

// ----------------------------------------------------------------------

export const TableActionButton = memo<TableActionButtonProps>(props => {
  const {
    status,
    isLoading,
    handleClickStopBtn,
    handleClickStartBtn,
    handleClickResetBtn,
    handleClickDeleteBtn,
    errorLog,
    examId,
    examName,
    deleteModalOpen,
    onCloseDeleteModal,
    onUseData
  } = props;

  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleMenuItemClick = (action: VoidFunction) => {
    action();
    handleClose();
  };

  // Determine which modal to use based on URL
  const isMmlu = window.location.pathname.includes('/mmlu');
  const DeleteModal = isMmlu ? MmluDeleteConfirmModal : MlperfDeleteConfirmModal;

  switch (status) {
    case 'Running':
    case 'Pending':
    case 'Preparing':
    case 'Undefined':
      return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Button
            size="small"
            variant="contained"
            sx={btnStop}
            disabled={isLoading}
            onClick={handleClickStopBtn}
            startIcon={<StopRoundedIcon sx={{ fontSize: '0.875rem !important' }} />}
          >
            Stop
          </Button>
          <IconButton size="small" aria-label="More actions" onClick={handleClick} sx={{ width: 28, height: 28 }}>
            <MoreVertIcon sx={{ fontSize: '1rem' }} />
          </IconButton>
          <Menu anchorEl={anchorEl} open={open} onClose={handleClose}>
            <MenuItem disabled sx={{ fontSize: '0.8125rem' }}>Delete</MenuItem>
          </Menu>
        </Box>
      );

    case 'Error':
      return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <ErrorViewLog message={errorLog!} />
          <Button size="small" variant="contained" sx={btnUseData} onClick={onUseData}>
            <ContentCopyOutlinedIcon sx={{ fontSize: '0.8125rem !important', mr: 0.5 }} />
            Use
          </Button>
          <IconButton size="small" aria-label="More actions" onClick={handleClick} sx={{ width: 28, height: 28 }}>
            <MoreVertIcon sx={{ fontSize: '1rem' }} />
          </IconButton>
          <Menu anchorEl={anchorEl} open={open} onClose={handleClose}>
            <MenuItem onClick={() => handleMenuItemClick(handleClickDeleteBtn)} sx={{ fontSize: '0.8125rem', color: '#EF4444' }}>Delete</MenuItem>
          </Menu>
          <DeleteModal
            examId={deleteModalOpen ? examId : null}
            examName={examName}
            onClose={onCloseDeleteModal}
          />
        </Box>
      );

    case 'Completed':
    case 'Stopped':
      return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Button
            size="small"
            variant="contained"
            sx={btnResult}
            onClick={handleClickResetBtn}
            startIcon={<AssessmentOutlinedIcon sx={{ fontSize: '0.8125rem !important' }} />}
          >
            Result
          </Button>
          <Button size="small" variant="contained" sx={btnUseData} onClick={onUseData}>
            <ContentCopyOutlinedIcon sx={{ fontSize: '0.8125rem !important', mr: 0.5 }} />
            Use
          </Button>
          <IconButton size="small" aria-label="More actions" onClick={handleClick} sx={{ width: 28, height: 28 }}>
            <MoreVertIcon sx={{ fontSize: '1rem' }} />
          </IconButton>
          <Menu anchorEl={anchorEl} open={open} onClose={handleClose}>
            <MenuItem onClick={() => handleMenuItemClick(handleClickDeleteBtn)} sx={{ fontSize: '0.8125rem', color: '#EF4444' }}>Delete</MenuItem>
          </Menu>
          <DeleteModal
            examId={deleteModalOpen ? examId : null}
            examName={examName}
            onClose={onCloseDeleteModal}
          />
        </Box>
      );

    default:
      // Idle / Waiting for start
      return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Button
            size="small"
            disabled={isLoading}
            variant="contained"
            sx={btnStart}
            onClick={handleClickStartBtn}
            startIcon={<PlayArrowRoundedIcon sx={{ fontSize: '0.875rem !important' }} />}
          >
            Start
          </Button>
          <IconButton size="small" aria-label="More actions" onClick={handleClick} sx={{ width: 28, height: 28 }}>
            <MoreVertIcon sx={{ fontSize: '1rem' }} />
          </IconButton>
          <Menu anchorEl={anchorEl} open={open} onClose={handleClose}>
            <MenuItem onClick={() => handleMenuItemClick(handleClickDeleteBtn)} sx={{ fontSize: '0.8125rem', color: '#EF4444' }}>Delete</MenuItem>
          </Menu>
          <DeleteModal
            examId={deleteModalOpen ? examId : null}
            examName={examName}
            onClose={onCloseDeleteModal}
          />
        </Box>
      );
  }
});
