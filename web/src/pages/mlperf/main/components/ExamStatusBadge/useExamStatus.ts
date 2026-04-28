import { type Query, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { type AxiosError } from 'axios';

import { MpExamApi } from '@/api/domains/mp-exam.domain.ts';
import type { ExamStatusResponse } from '@/api/types/common.types';
import { HTTP_CODE_BAD_REQUEST, HTTP_CODE_SERVER_ERROR } from '@/constants/http-code.constants';
import { StatusEnum } from '@/enums/status.enum';

import { MpExamQueryKeys } from '@/contexts/QueryContext/query.keys';

type MpExamStatusConfig = { id: number; status: StatusEnum; tablePageNumber: number };

export const useMpExamStatus = (config: MpExamStatusConfig) => {
  const { status, id, tablePageNumber: _tablePageNumber } = config;

  const queryClient = useQueryClient();

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
    }
  };

  const isEnabled =
    status === StatusEnum.UNDEFINED ||
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

      return 10_000; // per 10 seconds
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
  }

  return data;
};
