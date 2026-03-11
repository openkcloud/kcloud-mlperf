import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';

import { MmExamApi } from '@/api/domains/mm-exam.domains.ts';

import { MmExamQueryKeys } from '@/contexts/QueryContext/query.keys.ts';

export const useMmExamTestResult = () => {
  const { id } = useParams() as { id: string };

  const { data } = useQuery({
    queryKey: MmExamQueryKeys.details(id),
    queryFn: () => MmExamApi.examDetails(id),
    staleTime: Infinity
  });

  return data;
};
