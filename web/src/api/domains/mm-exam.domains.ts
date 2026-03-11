import type {
  ExamStatusResponse,
  GpuList,
  PaginationMeta,
  PaginationParams
} from '@/api/types/common.types';
import type {
  MmExamCreateBody,
  MmExamResultList,
  MmExamResultResponse
} from '@/api/types/mm-exam.types';
import { httpClient } from '@/libs/http-client';

export const MmExamApi = {
  create: async (body: MmExamCreateBody) => {
    const { data } = await httpClient.post<MmExamResultList>('/mm-exam/create', {
      ...body
    });

    return data;
  },

  // ----------------------------------------------------------------------

  update: async (params: { id: number } & Partial<MmExamCreateBody>) => {
    const { id, ...rest } = params;

    const { data } = await httpClient.patch<MmExamResultResponse>(`mm-exam/update/${id}`, {
      ...rest
    });

    return data;
  },

  // ----------------------------------------------------------------------

  list: async (params: PaginationParams) => {
    const { data } = await httpClient.get<PaginationMeta<MmExamResultList>>('/mm-exam/list', {
      params
    });

    return data;
  },

  // ----------------------------------------------------------------------

  gpuList: async () => {
    const { data } = await httpClient.get<{ gpus: GpuList[] }>('/mm-exam/gpu-list');

    return data;
  },

  // ----------------------------------------------------------------------

  getExamStatus: async (id: number) => {
    const { data } = await httpClient.get<ExamStatusResponse>(`/mm-exam/status/${id}`);

    return data;
  },

  // ----------------------------------------------------------------------

  updateExamStartTime: async (id: number) => {
    const { data } = await httpClient.patch<{ message: string }>(`/mm-exam/start-time/${id}`);

    return data;
  },

  // ----------------------------------------------------------------------

  stopExam: async (id: number) => {
    const { data } = await httpClient.patch<MmExamResultList>(`mm-exam/stop/${id}`);

    return data;
  },

  // ----------------------------------------------------------------------

  examDetails: async (id: number | string) => {
    const { data } = await httpClient.get<MmExamResultResponse>(`/mm-exam/details/${id}`);

    return data;
  },

  // ----------------------------------------------------------------------

  deleteExam: async (id: number) => {
    const { data } = await httpClient.delete<{ deleted: boolean }>(`/mm-exam/delete/${id}`);

    return data;
  }
} as const;
