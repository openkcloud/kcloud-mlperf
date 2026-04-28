import { type Query, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { type AxiosError } from 'axios';

import { MmExamApi } from '@/api/domains/mm-exam.domains';
import type { ExamStatusResponse } from '@/api/types/common.types';
import { HTTP_CODE_BAD_REQUEST, HTTP_CODE_SERVER_ERROR } from '@/constants/http-code.constants.ts';
import { StatusEnum } from '@/enums/status.enum';

import { MmExamQueryKeys } from '@/contexts/QueryContext/query.keys';

type ExamStatusConfig = { id: number; status: StatusEnum; tablePageNumber: number };

export const useExamStatus = (config: ExamStatusConfig) => {
  const { status, id, tablePageNumber: _tablePageNumber } = config;

  const queryClient = useQueryClient();

  const updateExamStatus = async () => {
    await MmExamApi.update({
      id,
      status: StatusEnum.ERROR
    });

    await queryClient.invalidateQueries({
      queryKey: MmExamQueryKeys.list(1, 10000)
    });
  };

  const isEnabled =
    status === StatusEnum.UNDEFINED ||
    status === StatusEnum.PENDING ||
    status === StatusEnum.PREPARING ||
    status === StatusEnum.RUNNING;

  const { data } = useQuery({
    queryKey: MmExamQueryKeys.checkExamStatus(id),
    queryFn: () => MmExamApi.getExamStatus(id),
    refetchInterval: (data: Query<ExamStatusResponse, AxiosError>) => {
      if (
        data &&
        (data.state.error?.status === HTTP_CODE_SERVER_ERROR ||
          data.state.error?.status === HTTP_CODE_BAD_REQUEST)
      ) {
        updateExamStatus().then();

        return false;
      }

      return 10_000; // per 10 seconds
    },
    enabled: isEnabled
  });

  useEffect(() => {
    if (!data) return;

    if (data.status === 'Completed' || data.status === 'Error') {
      const revalidateTableList = async () => {
        await queryClient.invalidateQueries({
          queryKey: MmExamQueryKeys.list(1, 10000)
        });
      };

      revalidateTableList().then();
    }
  }, [data]);

  return data;
};
