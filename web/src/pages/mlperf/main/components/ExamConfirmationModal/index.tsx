import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import Settings from '@mui/icons-material/Settings';
import { Box, Button, Grid, Typography } from '@mui/material';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

import { MpExamApi } from '@/api/domains/mp-exam.domain.ts';
import type { MpExamCreateBody } from '@/api/types/mp-exam.types';
import { ExamCreateModal } from '@/components/Modal/ExamCreateModal';
import { TIMEZONE } from '@/constants/timezone.constants.ts';
import { useStore } from '@/store';

import { MpExamQueryKeys } from '@/contexts/QueryContext/query.keys';

// ----------------------------------------------------------------------

dayjs.extend(utc);
dayjs.extend(timezone);

// ----------------------------------------------------------------------

type MmluExamConfirmationModalProps = {
  modalState: MpExamCreateBody | null;
  handleClose: VoidFunction;
};

// ----------------------------------------------------------------------

const nTrainModel = {
  extra_args: ` `
};

// ----------------------------------------------------------------------

export const MpExamConfirmationModal = (props: MmluExamConfirmationModalProps) => {
  const { modalState, handleClose } = props;

  const queryClient = useQueryClient();

  const [openSettings, setOpenSettings] = useState(false);

  const { setNotification, setErrorNotification } = useStore(store => store.notification);

  const handleSubmit = async () => {
    if (!modalState) return;

    try {
      const data = await MpExamApi.create({
        ...modalState
      });

      await queryClient.invalidateQueries({
        queryKey: MpExamQueryKeys.list(1, 10000)
      });

      setNotification({
        type: 'success',
        message: `MLPerf exam ${data.id} is successfully created!`
      });

      handleClose();
    } catch (error) {
      console.error(error);
      setErrorNotification(error);
    }
  };

  const onCancel = () => {
    handleClose();
    setOpenSettings(false);
    setOpenSettings(false);
  };

  return (
    <ExamCreateModal open={Boolean(modalState)} onClose={handleClose}>
      <Typography
        component={'h3'}
        fontSize={'1.5rem'}
        fontWeight={600}
        sx={theme => ({
          color: theme.palette.grey[900],
          lineHeight: '1.75rem'
        })}
        marginBottom={'0.875rem'}
      >
        Confirmation exam creation
      </Typography>
      {!openSettings && (
        <Box>
          <Typography component={'p'} color={'secondary'} marginBottom={'0.875rem'}>
            A new exam is created with the following contents:
          </Typography>
          <Box marginBottom={'0.875rem'}>
            <Typography component={'span'} fontWeight={500} marginRight={'0.5rem'}>
              Exam name:
            </Typography>
            <Typography component={'span'} color={'secondary'}>
              {modalState?.name}
            </Typography>
          </Box>
          <Box marginBottom={'0.875rem'}>
            <Typography component={'span'} fontWeight={500} marginRight={'0.5rem'}>
              Exam description:
            </Typography>
            <Typography component={'span'} color={'secondary'}>
              {modalState?.description}
            </Typography>
          </Box>
          <Box marginBottom={'0.875rem'}>
            <Typography component={'span'} fontWeight={500} marginRight={'0.5rem'}>
              Model:
            </Typography>
            <Typography component={'span'} color={'secondary'}>
              {modalState?.model}
            </Typography>
          </Box>
          <Box marginBottom={'0.875rem'}>
            <Typography component={'span'} fontWeight={500} marginRight={'0.5rem'}>
              Precision:
            </Typography>
            <Typography component={'span'} color={'secondary'}>
              {modalState?.precision}
            </Typography>
          </Box>
          <Box marginBottom={'0.875rem'}>
            <Typography component={'span'} fontWeight={500} marginRight={'0.5rem'}>
              Framework:
            </Typography>
            <Typography component={'span'} color={'secondary'}>
              {modalState?.framework}
            </Typography>
          </Box>
          <Box marginBottom={'0.875rem'}>
            <Typography component={'span'} fontWeight={500} marginRight={'0.5rem'}>
              Dataset:
            </Typography>
            <Typography component={'span'} color={'secondary'}>
              {modalState?.dataset}
            </Typography>
          </Box>
          <Box marginBottom={'0.875rem'}>
            <Typography component={'span'} fontWeight={500} marginRight={'0.5rem'}>
              Number of data:
            </Typography>
            <Typography component={'span'} color={'secondary'}>
              {modalState?.data_number}
            </Typography>
          </Box>{' '}
          <Box marginBottom={'0.875rem'}>
            <Typography component={'span'} fontWeight={500} marginRight={'0.5rem'}>
              Exam mode:
            </Typography>
            <Typography component={'span'} color={'secondary'}>
              {modalState?.mode}
            </Typography>
          </Box>{' '}
          <Box marginBottom={'0.875rem'}>
            <Typography component={'span'} fontWeight={500} marginRight={'0.5rem'}>
              Exam scenario:
            </Typography>
            <Typography component={'span'} color={'secondary'}>
              {modalState?.scenario}
            </Typography>
          </Box>
          <Box marginBottom={'0.875rem'}>
            <Typography component={'span'} fontWeight={500} marginRight={'0.5rem'}>
              Exam target QPS:
            </Typography>
            <Typography component={'span'} color={'secondary'}>
              {modalState?.target_qps}
            </Typography>
          </Box>{' '}
          <Box marginBottom={'0.875rem'}>
            <Typography component={'span'} fontWeight={500} marginRight={'0.5rem'}>
              Batch size:
            </Typography>
            <Typography component={'span'} color={'secondary'}>
              {modalState?.batch_size}
            </Typography>
          </Box>{' '}
          <Box marginBottom={'0.875rem'}>
            <Typography component={'span'} fontWeight={500} marginRight={'0.5rem'}>
              Number of workers:
            </Typography>
            <Typography component={'span'} color={'secondary'}>
              {modalState?.num_workers}
            </Typography>
          </Box>{' '}
          <Box marginBottom={'0.875rem'}>
            <Typography component={'span'} fontWeight={500} marginRight={'0.5rem'}>
              Minimum duration:
            </Typography>
            <Typography component={'span'} color={'secondary'}>
              {modalState?.min_duration}
            </Typography>
          </Box>
          <Box marginBottom={'0.875rem'}>
            <Typography component={'span'} fontWeight={500} marginRight={'0.5rem'}>
              GPU:
            </Typography>
            <Typography component={'span'} color={'secondary'}>
              {modalState?.gpu_type} x {modalState?.gpu_num}
            </Typography>
          </Box>
          <Box marginBottom={'0.875rem'}>
            <Typography component={'span'} fontWeight={500} marginRight={'0.5rem'}>
              CPU:
            </Typography>
            <Typography component={'span'} color={'secondary'}>
              {modalState?.cpu_core} Core
            </Typography>
          </Box>
          <Box marginBottom={'0.875rem'}>
            <Typography component={'span'} fontWeight={500} marginRight={'0.5rem'}>
              RAM:
            </Typography>
            <Typography component={'span'} color={'secondary'}>
              {modalState?.ram_capacity} GB
            </Typography>
          </Box>
          <Box marginBottom={'0.875rem'}>
            <Typography component={'span'} fontWeight={500} marginRight={'0.5rem'}>
              Number of repetitions:
            </Typography>
            <Typography component={'span'} color={'secondary'}>
              {modalState?.retry_num} times
            </Typography>
          </Box>
          <Box marginBottom={'0.875rem'}>
            <Typography component={'span'} fontWeight={500} marginRight={'0.5rem'}>
              Start time:
            </Typography>
            <Typography component={'span'} color={'secondary'}>
              {dayjs(modalState?.started_at).tz(TIMEZONE).format('YYYY-MM-DDT HH:mm')}
            </Typography>
          </Box>
        </Box>
      )}
      {openSettings && (
        <Box marginBottom={'0.875rem'}>
          <Box
            sx={{
              backgroundColor: '#1e1e1e',
              color: '#fff',
              p: 2,
              borderRadius: 2,
              fontFamily: 'monospace',
              fontSize: '14px',
              overflowX: 'auto',
              whiteSpace: 'pre-wrap'
            }}
          >
            <Typography component="pre" sx={{ m: 0 }}>
              {JSON.stringify(nTrainModel, null, 2)}
            </Typography>
          </Box>
        </Box>
      )}
      <Grid container spacing={2}>
        <Grid size={5}>
          <Button size={'large'} fullWidth variant={'outlined'} onClick={onCancel}>
            Cancel
          </Button>
        </Grid>
        <Grid size={5}>
          <Button size={'large'} fullWidth variant={'contained'} onClick={handleSubmit}>
            Generate
          </Button>
        </Grid>
        <Grid size={2}>
          <Button
            size={'large'}
            fullWidth
            variant={'contained'}
            sx={{
              minWidth: 'fit-content',
              padding: '0.5rem'
            }}
            onClick={() => setOpenSettings(true)}
          >
            <Settings />
          </Button>
        </Grid>
      </Grid>
    </ExamCreateModal>
  );
};
