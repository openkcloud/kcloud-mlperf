import type {
  ExamStatusResponse,
  GpuList,
  PaginationMeta,
  PaginationParams
} from '@/api/types/common.types';
import type {
  MpExamCreateBody,
  MpExamDetails,
  MpExamResultResponse
} from '@/api/types/mp-exam.types';
import { httpClient } from '@/libs/http-client';

export const MpExamApi = {
  create: async (body: MpExamCreateBody) => {
    const { data } = await httpClient.post<MpExamDetails>('/mp-exam/create', {
      ...body
    });

    return data;
  },

  // ----------------------------------------------------------------------

  update: async (params: { id: number } & Partial<MpExamCreateBody>) => {
    const { id, ...rest } = params;

    const { data } = await httpClient.patch<MpExamDetails>(`mp-exam/update/${id}`, {
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

    const { data } = await httpClient.get<PaginationMeta<MpExamDetails>>('/mp-exam/list', {
      params: filteredParams
    });

    return data;
  },

  // ----------------------------------------------------------------------

  details: async (id: number) => {
    const { data } = await httpClient.get<MpExamResultResponse>(`/mp-exam/details/${id}`);

    return data;
  },

  // ----------------------------------------------------------------------

  gpuList: async () => {
    const { data } = await httpClient.get<{ gpus: GpuList[] }>('/mp-exam/gpu-list');

    return data;
  },

  // ----------------------------------------------------------------------

  getExamStatus: async (id: number) => {
    const { data } = await httpClient.get<ExamStatusResponse>(`/mp-exam/status/${id}`);

    return data;
  },

  // ----------------------------------------------------------------------

  updateExamStartTime: async (id: number) => {
    const { data } = await httpClient.patch<{ message: string }>(`/mp-exam/start-time/${id}`);

    return data;
  },

  // ----------------------------------------------------------------------

  stopExam: async (id: number) => {
    const { data } = await httpClient.patch<MpExamDetails>(`mp-exam/stop/${id}`);

    return data;
  },

  // ----------------------------------------------------------------------

  examDetails: async (id: number | string) => {
    const { data } = await httpClient.get<MpExamResultResponse>(`/mp-exam/details/${id}`);

    return data;
  },

  // ----------------------------------------------------------------------

  deleteExam: async (id: number) => {
    const { data } = await httpClient.delete<{ deleted: boolean }>(`/mp-exam/delete/${id}`);

    return data;
  }
} as const;
