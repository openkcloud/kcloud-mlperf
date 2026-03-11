import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';

import { MpExamApi } from '@/api/domains/mp-exam.domain.ts';

import { MpExamQueryKeys } from '@/contexts/QueryContext/query.keys.ts';

export const useTestResult = () => {
  const { id } = useParams() as { id: string };

  const { data } = useQuery({
    queryKey: MpExamQueryKeys.details(id),
    queryFn: () => MpExamApi.details(Number(id)),
    staleTime: Infinity
  });

  return data;
};
