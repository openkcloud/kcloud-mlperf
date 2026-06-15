import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { MpExamApi } from '@/api/domains/mp-exam.domain.ts';
import type { MpExamDetails } from '@/api/types/mp-exam.types';
import { TableActionButton } from '@/components/Table/TableActionButton.tsx';
import { type StatusEnum } from '@/enums/status.enum.ts';
import { useStore } from '@/store';

import { MpExamQueryKeys } from '@/contexts/QueryContext/query.keys.ts';
import { MpExamPageLinks } from '@/contexts/RouterContext/router.links';

// ----------------------------------------------------------------------

type MlPerfExamActionButtonProps = {
  id: number;
  name: string;
  status: StatusEnum;
  tablePageNumber: number;
  errorLog: string | null;
  exam: MpExamDetails;
  onUseData?: (exam: MpExamDetails) => void;
};

// ----------------------------------------------------------------------

export const MlPerfExamActionButton = (props: MlPerfExamActionButtonProps) => {
  const { status, id, name, tablePageNumber: _tablePageNumber, errorLog, exam, onUseData } = props;

  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [isLoading, setIsLoading] = useState<boolean>(false);

  const { setNotification, setErrorNotification } = useStore(store => store.notification);

  const handleClickStartBtn = async () => {
    setIsLoading(true);
    try {
      await MpExamApi.updateExamStartTime(id);

      const { status, message } = await queryClient.fetchQuery({
        queryKey: MpExamQueryKeys.checkExamStatus(id),
        queryFn: () => MpExamApi.getExamStatus(id)
      });

      await queryClient.invalidateQueries({
        queryKey: MpExamQueryKeys.list(1, 10000)
      });

      setNotification({ type: 'success', message: `${status.toUpperCase()} ${message}` });
    } catch (error) {
      console.error({ error });
      setErrorNotification(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClickStopBtn = async () => {
    setIsLoading(true);

    try {
      const { status } = await MpExamApi.stopExam(id);

      await queryClient.invalidateQueries({
        queryKey: MpExamQueryKeys.list(1, 10000)
      });

      setNotification({
        type: 'success',
        message: ` The exam is successfully ${status.toUpperCase()}!`
      });
    } catch (error) {
      console.error(error);
      setErrorNotification(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClickResultBtn = () => {
    navigate(MpExamPageLinks.testResult(id));
  };

  const [deleteModalOpen, setDeleteModalOpen] = useState<boolean>(false);

  const handleClickDeleteBtn = () => {
    setDeleteModalOpen(true);
  };

  const handleCloseDeleteModal = () => {
    setDeleteModalOpen(false);
  };

  return (
    <>
      <TableActionButton
        status={status}
        handleClickStartBtn={handleClickStartBtn}
        handleClickStopBtn={handleClickStopBtn}
        handleClickResetBtn={handleClickResultBtn}
        handleClickDeleteBtn={handleClickDeleteBtn}
        isLoading={isLoading}
        errorLog={errorLog}
        examId={id}
        examName={name}
        deleteModalOpen={deleteModalOpen}
        onCloseDeleteModal={handleCloseDeleteModal}
        onUseData={() => onUseData?.(exam)}
      />
    </>
  );
};
export default MlPerfExamActionButton;
