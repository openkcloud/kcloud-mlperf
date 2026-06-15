import { type Query, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { type AxiosError } from 'axios';

import { MpExamApi } from '@/api/domains/mp-exam.domain.ts';
import type { ExamStatusResponse } from '@/api/types/common.types';
import { HTTP_CODE_BAD_REQUEST, HTTP_CODE_SERVER_ERROR } from '@/constants/http-code.constants';
import { StatusEnum } from '@/enums/status.enum';
import { useStore } from '@/store';

import { MpExamQueryKeys } from '@/contexts/QueryContext/query.keys';

type MpExamStatusConfig = { id: number; status: StatusEnum; tablePageNumber: number };

export const useMpExamStatus = (config: MpExamStatusConfig) => {
  const { status, id, tablePageNumber: _tablePageNumber } = config;

  const queryClient = useQueryClient();
  const { setErrorNotification } = useStore(store => store.notification);

  const updateExamStatus = async () => {
    try {
      await MpExamApi.update({
        id,
        status: StatusEnum.ERROR
      });

      await queryClient.invalidateQueries({
        queryKey: MpExamQueryKeys.list(1, 10000)
      });
    } catch (error) {
      console.error(error);
      setErrorNotification(error);
    }
  };

  // IDLE included to recover rows that get stuck at IDLE while the K8s
  // pod runs (operator hasn't fired the first phase update yet).
  const isEnabled =
    status === StatusEnum.UNDEFINED ||
    status === StatusEnum.IDLE ||
    status === StatusEnum.PENDING ||
    status === StatusEnum.PREPARING ||
    status === StatusEnum.RUNNING;

  const { data, error, isError } = useQuery({
    queryKey: MpExamQueryKeys.checkExamStatus(id),
    queryFn: () => MpExamApi.getExamStatus(id),
    refetchInterval: (data: Query<ExamStatusResponse, AxiosError>) => {
      if (
        data &&
        (data.state.error?.status === HTTP_CODE_SERVER_ERROR ||
          data.state.error?.status === HTTP_CODE_BAD_REQUEST)
      ) {
        updateExamStatus().then();
        return false;
      }

      // 3s poll: faster status flip after operator reconciles, so the user
      // doesn't sit on a 99% bar for the 30s reconcile + 10s old poll window.
      return 3_000;
    },
    enabled: isEnabled
  });

  useEffect(() => {
    if (!data) return;

    if (data.status === 'Completed' || data.status === 'Error') {
      const revalidateTableList = async () => {
        await queryClient.invalidateQueries({
          queryKey: MpExamQueryKeys.list(1, 10000)
        });
      };

      revalidateTableList().then();
    }
  }, [data]);

  if (isError) {
    console.error(error);
    setErrorNotification(error);
  }

  return data;
};
