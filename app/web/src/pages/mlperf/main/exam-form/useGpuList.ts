import { useQuery } from '@tanstack/react-query';

import { MpExamApi } from '@/api/domains/mp-exam.domain.ts';

import { MpExamQueryKeys } from '@/contexts/QueryContext/query.keys.ts';

export const useMpGpuList = () => {
  const { data, isLoading, refetch } = useQuery({
    queryKey: MpExamQueryKeys.gpuList(),
    queryFn: MpExamApi.gpuList,
    staleTime: Infinity
  });

  return { gpuList: data, isLoading, refetchGpuList: refetch };
};
