import type {
  ExamStatusResponse,
  PaginationMeta,
  PaginationParams
} from '@/api/types/common.types';
import type {
  NpuExamCreateBody,
  NpuExamDetails,
  NpuExamResultResponse,
  NpuListResponse
} from '@/api/types/npu-eval.types';
import { httpClient } from '@/libs/http-client';

export const NpuEvalApi = {
  create: async (body: NpuExamCreateBody) => {
    const { data } = await httpClient.post<NpuExamDetails>('/npu-eval/create', {
      ...body
    });

    return data;
  },

  // ----------------------------------------------------------------------

  update: async (params: { id: number } & Partial<NpuExamCreateBody>) => {
    const { id, ...rest } = params;

    const { data } = await httpClient.patch<NpuExamDetails>(`/npu-eval/update/${id}`, {
      ...rest
    });

    return data;
  },

  // ----------------------------------------------------------------------

  list: async (params: PaginationParams) => {
    const filteredParams = {
      page: params.page,
      limit: params.limit,
      ...(params.search && params.search.trim() !== '' ? { search: params.search } : {})
    };

    const { data } = await httpClient.get<PaginationMeta<NpuExamDetails>>('/npu-eval/list', {
      params: filteredParams
    });

    return data;
  },

  // ----------------------------------------------------------------------

  details: async (id: number) => {
    const { data } = await httpClient.get<NpuExamResultResponse>(`/npu-eval/details/${id}`);

    return data;
  },

  // ----------------------------------------------------------------------

  npuList: async () => {
    const { data } = await httpClient.get<NpuListResponse>('/npu-eval/npu-list');

    return data;
  },

  // ----------------------------------------------------------------------

  getExamStatus: async (id: number) => {
    const { data } = await httpClient.get<ExamStatusResponse>(`/npu-eval/status/${id}`);

    return data;
  },

  // ----------------------------------------------------------------------

  updateExamStartTime: async (id: number) => {
    const { data } = await httpClient.patch<{ message: string }>(`/npu-eval/start-time/${id}`);

    return data;
  },

  // ----------------------------------------------------------------------

  stopExam: async (id: number) => {
    const { data } = await httpClient.patch<NpuExamDetails>(`/npu-eval/stop/${id}`);

    return data;
  },

  // ----------------------------------------------------------------------

  examDetails: async (id: number | string) => {
    const { data } = await httpClient.get<NpuExamResultResponse>(`/npu-eval/details/${id}`);

    return data;
  },

  // ----------------------------------------------------------------------

  deleteExam: async (id: number) => {
    const { data } = await httpClient.delete<{ deleted: boolean }>(`/npu-eval/delete/${id}`);

    return data;
  }
} as const;
