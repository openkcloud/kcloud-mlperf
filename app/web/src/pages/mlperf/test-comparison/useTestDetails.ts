import { useQueries } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';

import { MpExamApi } from '@/api/domains/mp-exam.domain.ts';

import { MpExamQueryKeys } from '@/contexts/QueryContext/query.keys.ts';

export const useTestDetails = () => {
  const { firstId, secondId } = useParams() as { firstId: string; secondId: string };

  const [firstRes, secondRes] = useQueries({
    queries: [
      {
        queryKey: MpExamQueryKeys.details(firstId),
        queryFn: () => MpExamApi.details(Number(firstId)),
        staleTime: Infinity
      },
      {
        queryKey: MpExamQueryKeys.details(secondId),
        queryFn: () => MpExamApi.details(Number(secondId)),
        staleTime: Infinity
      }
    ]
  });

  return {
    firstTestResult: firstRes.data,
    secondTestResult: secondRes.data
  };
};
