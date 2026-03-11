import { useQuery } from '@tanstack/react-query';

import { FilesApi } from '@/api/domains/files.domains';

import { FilesQueryKeys } from '@/contexts/QueryContext/query.keys.ts';

export const useModelsList = () => {
  const { data = [], refetch } = useQuery({
    queryKey: FilesQueryKeys.models(),
    queryFn: FilesApi.models,
    staleTime: Infinity
  });

  return {
    models: data.map(model => ({ label: model.name, value: model.name })),
    refetchModels: refetch
  };
};
