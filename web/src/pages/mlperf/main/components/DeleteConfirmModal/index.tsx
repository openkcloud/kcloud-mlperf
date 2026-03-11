import { memo } from 'react';
import { Box, Button, Modal, Typography } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';

import { MpExamApi } from '@/api/domains/mp-exam.domain';
import { MpExamQueryKeys } from '@/contexts/QueryContext/query.keys';
import { useStore } from '@/store';

// ----------------------------------------------------------------------

type DeleteConfirmModalProps = {
  examId: number | null;
  examName: string;
  onClose: () => void;
};

// ----------------------------------------------------------------------

export const DeleteConfirmModal = memo<DeleteConfirmModalProps>(props => {
  const { examId, examName, onClose } = props;

  const queryClient = useQueryClient();
  const { setNotification, setErrorNotification } = useStore(store => store.notification);

  const handleConfirm = async () => {
    if (!examId) return;

    try {
      await MpExamApi.deleteExam(examId);
      
      await queryClient.invalidateQueries({
        queryKey: MpExamQueryKeys.list(1, 10000)
      });

      setNotification({
        type: 'success',
        message: 'Exam deleted successfully'
      });

      onClose();
    } catch (error) {
      setErrorNotification({
        type: 'error',
        message: 'Exam deletion failed'
      });
    }
  };

  return (
    <Modal open={examId !== null} onClose={onClose}>
      <Box
        sx={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 400,
          bgcolor: 'background.paper',
          boxShadow: 24,
          p: 4,
          borderRadius: 2
        }}
      >
        <Typography variant="h6" component="h2" mb={2}>
          Delete Exam
        </Typography>
        <Typography mb={3}>
          <strong>{examName}</strong> 정말 삭제하시겠습니까?
        </Typography>
        <Box display="flex" justifyContent="flex-end" gap={2}>
          <Button variant="outlined" onClick={onClose}>
            CANCEL
          </Button>
          <Button variant="contained" color="error" onClick={handleConfirm}>
            CONFIRM
          </Button>
        </Box>
      </Box>
    </Modal>
  );
});
