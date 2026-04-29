import { generatePath } from 'react-router-dom';

import { join } from '@/contexts/RouterContext/router.helpers';
import { AdminPaths, DashboardPaths, HomePaths, MlPerfPaths, MmluPaths, NpuEvalPaths } from '@/contexts/RouterContext/router.paths';

export const HomePageLinks = {
  main: HomePaths.ROOT_PATH
} as const;

// ----------------------------------------------------------------------

export const MpExamPageLinks = {
  main: MlPerfPaths.ROOT_PATH,
  testComparison: (firstId: number | string, secondId: number | string) =>
    generatePath(join(MlPerfPaths.ROOT_PATH, MlPerfPaths.COMPARISON_PATH), {
      firstId: firstId.toString(),
      secondId: secondId.toString()
    }),
  testResult: (id: number | string) =>
    generatePath(join(MlPerfPaths.ROOT_PATH, MlPerfPaths.RESULT_PATH), { id: id.toString() }),
  deviceComparison: join(MlPerfPaths.ROOT_PATH, MlPerfPaths.DEVICE_COMPARISON_PATH)
} as const;

// ----------------------------------------------------------------------

export const MmluPageLinks = {
  main: MmluPaths.ROOT_PATH,
  testComparison: (firstId: string | number, secondId: string | number) =>
    generatePath(join(MmluPaths.ROOT_PATH, MmluPaths.COMPARISON_PATH), {
      firstId: firstId.toString(),
      secondId: secondId.toString()
    }),
  testResult: (id: string | number) =>
    generatePath(join(MmluPaths.ROOT_PATH, MmluPaths.RESULT_PATH), { id: id.toString() }),
  deviceComparison: join(MmluPaths.ROOT_PATH, MmluPaths.DEVICE_COMPARISON_PATH)
} as const;

// ----------------------------------------------------------------------

export const NpuEvalPageLinks = {
  main: NpuEvalPaths.ROOT_PATH,
  testComparison: (firstId: number | string, secondId: number | string) =>
    generatePath(join(NpuEvalPaths.ROOT_PATH, NpuEvalPaths.COMPARISON_PATH), {
      firstId: firstId.toString(),
      secondId: secondId.toString()
    }),
  testResult: (id: number | string) =>
    generatePath(join(NpuEvalPaths.ROOT_PATH, NpuEvalPaths.RESULT_PATH), { id: id.toString() }),
  deviceComparison: join(NpuEvalPaths.ROOT_PATH, NpuEvalPaths.DEVICE_COMPARISON_PATH)
} as const;

// ----------------------------------------------------------------------

export const DashboardPageLinks = {
  gpuRealtime: join(DashboardPaths.ROOT_PATH, DashboardPaths.GPU_REALTIME_PATH),
  npuRealtime: join(DashboardPaths.ROOT_PATH, DashboardPaths.NPU_REALTIME_PATH),
  sweepControl: join(DashboardPaths.ROOT_PATH, DashboardPaths.SWEEP_CONTROL_PATH)
} as const;
