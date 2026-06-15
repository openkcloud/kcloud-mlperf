import { useQueries } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';

import { MmExamApi } from '@/api/domains/mm-exam.domains';

import { MmExamQueryKeys } from '@/contexts/QueryContext/query.keys.ts';

export const useMmExamTestDetails = () => {
  const { firstId, secondId } = useParams() as { firstId: string; secondId: string };

  const [firstRes, secondRes] = useQueries({
    queries: [
      {
        queryKey: MmExamQueryKeys.details(firstId),
        queryFn: () => MmExamApi.examDetails(firstId),
        staleTime: Infinity
      },
      {
        queryKey: MmExamQueryKeys.details(secondId),
        queryFn: () => MmExamApi.examDetails(secondId),
        staleTime: Infinity
      }
    ]
  });

  return {
    firstTestResult: firstRes.data,
    secondTestResult: secondRes.data
  };
};
