import { useQuery } from '@tanstack/react-query';

import { MpExamResultApi } from '@/api/domains/mp-exam-result';
import type { PaginationParams } from '@/api/types/common.types';

import { MpExamResultQueryKeys } from '@/contexts/QueryContext/query.keys.ts';

export const useMpExamResultsList = (params: PaginationParams) => {
  const { data, isLoading, refetch } = useQuery({
    queryKey: MpExamResultQueryKeys.list(params.page, params.limit),
    queryFn: () => MpExamResultApi.list(params),
    staleTime: Infinity
  });

  return {
    list: data?.list,
    total: data?.total,
    page: data?.page,
    limit: data?.limit,
    total_pages: data?.total_pages,
    isLoading,
    refetchMpExamResultsList: refetch
  };
};
