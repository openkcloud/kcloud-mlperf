import { useQuery } from '@tanstack/react-query';

import { FilesApi } from '@/api/domains/files.domains.ts';

import { FilesQueryKeys } from '@/contexts/QueryContext/query.keys.ts';

export const useDatasetsList = () => {
  const { data = [], refetch } = useQuery({
    queryKey: FilesQueryKeys.datasets(),
    queryFn: FilesApi.datasets,
    staleTime: Infinity
  });

  return {
    datasets: data.map(dataset => ({ label: dataset.name, value: dataset.name })),
    refetchDatasets: refetch
  };
};
