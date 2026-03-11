import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { MmExamApi } from '@/api/domains/mm-exam.domains.ts';
import type { MmExamResultList } from '@/api/types/mm-exam.types';
import { TableActionButton } from '@/components/Table/TableActionButton.tsx';
import { type StatusEnum } from '@/enums/status.enum.ts';
import { useStore } from '@/store';

import { MmExamQueryKeys } from '@/contexts/QueryContext/query.keys.ts';
import { MmluPageLinks } from '@/contexts/RouterContext/router.links';

// ----------------------------------------------------------------------

type ActionButtonProps = {
  id: number;
  name: string;
  status: StatusEnum;
  tablePageNumber: number;
  errorLog: string | null;
  exam: MmExamResultList;
  onUseData?: (exam: MmExamResultList) => void;
};

// ----------------------------------------------------------------------

export const MmluExamActionButton = (props: ActionButtonProps) => {
  const { status, id, name, tablePageNumber, errorLog, exam, onUseData } = props;

  const navigate = useNavigate();

  const { setNotification, setErrorNotification } = useStore(store => store.notification);

  const queryClient = useQueryClient();

  const [isLoading, setIsLoading] = useState<boolean>(false);

  const handleClickStartBtn = async () => {
    setIsLoading(true);
    try {
      await MmExamApi.updateExamStartTime(id);

      const { status, message } = await queryClient.fetchQuery({
        queryKey: MmExamQueryKeys.checkExamStatus(id),
        queryFn: () => MmExamApi.getExamStatus(id)
      });

      await queryClient.invalidateQueries({
        queryKey: MmExamQueryKeys.list(1, 10000)
      });

      setNotification({ type: 'success', message: `${status.toUpperCase()} ${message}` });
    } catch (error) {
      console.error(error);
      setErrorNotification(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClickStopBtn = async () => {
    setIsLoading(true);

    try {
      const { status } = await MmExamApi.stopExam(id);

      await queryClient.invalidateQueries({
        queryKey: MmExamQueryKeys.list(1, 10000)
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
    navigate(MmluPageLinks.testResult(id));
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
