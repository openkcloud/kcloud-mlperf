import { useQuery } from '@tanstack/react-query';

import { MpExamApi } from '@/api/domains/mp-exam.domain.ts';
import type { PaginationParams } from '@/api/types/common.types';

import { MpExamQueryKeys } from '@/contexts/QueryContext/query.keys.ts';

export const useMpExamResultList = (params: PaginationParams) => {
  const query = useQuery({
    queryKey: MpExamQueryKeys.list(params.page, params.limit, params.search),
    queryFn: () => MpExamApi.list(params),
    staleTime: Infinity
  });

  return { data: query.data, isLoading: query.isLoading, refetchMpExamList: query.refetch, query };
};
