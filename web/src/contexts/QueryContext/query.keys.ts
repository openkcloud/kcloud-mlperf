export const MpExamQueryKeys = {
  PREFIX: 'mp-exam',

  list: (page: number, limit: number = 10, search?: string) => [
    MpExamQueryKeys.PREFIX,
    'list',
    page,
    limit,
    search
  ],
  details: (id: number | string) => [MpExamQueryKeys.PREFIX, 'details', id.toString()],
  gpuList: () => [MpExamQueryKeys.PREFIX, 'gpu-list'],
  checkExamStatus: (id: string | number) => [MpExamQueryKeys.PREFIX, 'exam-status', id.toString()]
} as const;

// ----------------------------------------------------------------------

export const MpExamResultQueryKeys = {
  PREFIX: 'mp-exam-result',

  list: (page: number, limit: number = 10) => [MpExamResultQueryKeys.PREFIX, 'list', page, limit],
  details: (id: number | string) => [MpExamResultQueryKeys.PREFIX, 'details', id.toString()]
} as const;

// ----------------------------------------------------------------------

export const MmExamQueryKeys = {
  PREFIX: 'mmlu-exam',

  list: (page: number, limit: number = 10, search?: string) => [
    MmExamQueryKeys.PREFIX,
    'list',
    page,
    limit,
    search
  ],
  details: (id: number | string) => [MmExamQueryKeys.PREFIX, 'details', id.toString()],
  gpuList: () => [MmExamQueryKeys.PREFIX, 'gpu-list'],
  checkExamStatus: (id: string | number) => [MmExamQueryKeys.PREFIX, 'exam-status', id.toString()]
} as const;

// ----------------------------------------------------------------------

export const NpuEvalQueryKeys = {
  PREFIX: 'npu-eval',

  list: (page: number, limit: number = 10, search?: string) => [
    NpuEvalQueryKeys.PREFIX,
    'list',
    page,
    limit,
    search
  ],
  details: (id: number | string) => [NpuEvalQueryKeys.PREFIX, 'details', id.toString()],
  npuList: () => [NpuEvalQueryKeys.PREFIX, 'npu-list'],
  checkExamStatus: (id: string | number) => [NpuEvalQueryKeys.PREFIX, 'exam-status', id.toString()]
} as const;

// ----------------------------------------------------------------------

export const FilesQueryKeys = {
  PREFIX: 'files',

  models: () => [FilesQueryKeys.PREFIX, 'models-list'],
  datasets: () => [FilesQueryKeys.PREFIX, 'datasets-list'],
  settings: () => [FilesQueryKeys.PREFIX, 'settings']
};
