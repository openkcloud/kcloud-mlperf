export const HomePaths = {
  ROOT_PATH: '/'
} as const;

// ----------------------------------------------------------------------

export const MlPerfPaths = {
  ROOT_PATH: '/ml-perf',

  COMPARISON_PATH: 'test-comparison/:firstId/:secondId',
  RESULT_PATH: 'test-result/:id'
} as const;

// ----------------------------------------------------------------------

export const MmluPaths = {
  ROOT_PATH: '/mmlu',

  RESULT_PATH: 'test-result/:id',
  COMPARISON_PATH: 'test-comparison/:firstId/:secondId'
} as const;
