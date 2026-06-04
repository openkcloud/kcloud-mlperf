import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

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

// B-validation #22: pull a human-readable message out of an Axios/API error.
// NestJS class-validator failures arrive as { message: string | string[] }.
const extractApiErrorMessage = (error: unknown): string => {
  const response = (error as { response?: { data?: { message?: unknown }; statusText?: string } })?.response;
  const apiMessage = response?.data?.message;
  if (Array.isArray(apiMessage)) return apiMessage.join(', ');
  if (typeof apiMessage === 'string' && apiMessage.trim()) return apiMessage;
  if (response?.statusText) return response.statusText;
  if (error instanceof Error && error.message) return error.message;
  return 'Unknown error';
};

export const MpExamConfirmationModal = (props: MmluExamConfirmationModalProps) => {
  const { modalState, handleClose } = props;

  const queryClient = useQueryClient();

  // B-validation #22: disable the submit button while the create request is in
  // flight so the user cannot fire duplicate exams.
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { setNotification } = useStore(store => store.notification);

  const handleSubmit = async () => {
    if (!modalState || isSubmitting) return;

    setIsSubmitting(true);
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
      // B-validation #22: surface the real failure reason to the user instead
      // of swallowing it behind a bare status code.
      setNotification({
        type: 'error',
        message: `Failed to create test: ${extractApiErrorMessage(error)}`
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const onCancel = () => {
    handleClose();
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
      <Grid container spacing={2}>
        <Grid size={5}>
          <Button size={'large'} fullWidth variant={'outlined'} onClick={onCancel}>
            Cancel
          </Button>
        </Grid>
        <Grid size={7}>
          <Button
            size={'large'}
            fullWidth
            variant={'contained'}
            onClick={handleSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Generating...' : 'Generate'}
          </Button>
        </Grid>
      </Grid>
    </ExamCreateModal>
  );
};
