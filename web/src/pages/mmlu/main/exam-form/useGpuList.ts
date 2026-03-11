import { useQuery } from '@tanstack/react-query';

import { MmExamApi } from '@/api/domains/mm-exam.domains.ts';

import { MmExamQueryKeys } from '@/contexts/QueryContext/query.keys.ts';

export const useGpuList = () => {
  const { data, isLoading, refetch } = useQuery({
    queryKey: MmExamQueryKeys.gpuList(),
    queryFn: MmExamApi.gpuList,
    staleTime: Infinity
  });

  return { gpuList: data, isLoading, refetchGpuList: refetch };
};
