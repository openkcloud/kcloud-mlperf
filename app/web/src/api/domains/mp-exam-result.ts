import type { PaginationParams } from '../types/common.types';
import type { MpExamResultList } from '../types/mp-exam.types';

import { httpClient } from '@/libs/http-client';

export type MpExamResultListResponse = {
  list: MpExamResultList[]; // Array of exam result entities
  total: number; // Total number of records
  page: number; // Current page number
  limit: number; // Items per page
  total_pages: number; // Total number of pages
};
export const MpExamResultApi = {
  list: async (params: PaginationParams) => {
    const { data } = await httpClient.get<MpExamResultListResponse>('/mp-exam-result/list', {
      params
    });

    return data;
  }
} as const;
