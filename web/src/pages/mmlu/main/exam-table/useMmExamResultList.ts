import { useQuery } from '@tanstack/react-query';

import { MmExamApi } from '@/api/domains/mm-exam.domains.ts';
import type { PaginationParams } from '@/api/types/common.types';

import { MmExamQueryKeys } from '@/contexts/QueryContext/query.keys.ts';

export const useMmExamResultList = (_params: PaginationParams) => {
  const query = useQuery({
    queryKey: MmExamQueryKeys.list(1, 10000),
    queryFn: () => MmExamApi.list({ page: 1, limit: 10000 }),
    staleTime: Infinity
  });

  return { data: query.data, isLoading: query.isLoading, refetchMmExamList: query.refetch, query };
};
