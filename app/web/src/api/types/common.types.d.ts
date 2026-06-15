import { StatusEnum } from '@/enums/status.enum.ts';

export type PaginationParams = {
  page: number;
  limit: number;
  search?: string;
};

// ----------------------------------------------------------------------

export type PaginationMeta<T> = {
  list: Array<T>;
  total: number;
  page: number;
  limit: number;
  total_pages: number;
};

// ----------------------------------------------------------------------

export type ErrorResponse<T extends unknown> = {
  code: number;
  status: boolean;
  message: string;
  data: T;
};

// ----------------------------------------------------------------------

export type GpuList = {
  gpuModel: string;
  gpuCount: number;
};

// ----------------------------------------------------------------------

export type ExamStatusResponse = {
  status: StatusEnum;
  message: string;
  currentRepeatCount?: string;
  result: Array<{
    stream: {
      id: string;
      logger: string;
      severity: string;
    };
    values: Array<Array<string>>;
  }>;
  start_time: string;
};
