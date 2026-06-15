import type { FileList, Settings } from '@/api/types/files.types';
import { httpClient } from '@/libs/http-client';

export const FilesApi = {
  datasets: async () => {
    const { data } = await httpClient.get<FileList[]>('/files/datasets');

    return data;
  },

  models: async () => {
    const { data } = await httpClient.get<FileList[]>('/files/models');

    return data;
  },
  settings: async () => {
    const { data } = await httpClient.get<Settings>('/files/settings');

    return data;
  }
} as const;
