import { useQuery } from '@tanstack/react-query';

import { MmExamApi } from '@/api/domains/mm-exam.domains.ts';
import type { PaginationParams } from '@/api/types/common.types';

import { MmExamQueryKeys } from '@/contexts/QueryContext/query.keys.ts';

export const useMmExamResultList = (params: PaginationParams) => {
  const query = useQuery({
    queryKey: MmExamQueryKeys.list(params.page, params.limit, params.search),
    queryFn: () => MmExamApi.list(params),
    staleTime: Infinity
  });

  return { data: query.data, isLoading: query.isLoading, refetchMmExamList: query.refetch, query };
};
