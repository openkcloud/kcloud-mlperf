import { useQuery } from '@tanstack/react-query';

import { FilesApi } from '@/api/domains/files.domains';
import type { Settings } from '@/api/types/files.types';

import { FilesQueryKeys } from '@/contexts/QueryContext/query.keys.ts';

export const useSettingsList = () => {
  const { data, refetch } = useQuery<Settings>({
    queryKey: FilesQueryKeys.settings(),
    queryFn: FilesApi.settings,
    staleTime: Infinity
  });

  return {
    settings: data,
    refetchSettings: refetch
  };
};
