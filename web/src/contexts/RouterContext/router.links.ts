import { generatePath } from 'react-router-dom';

import { join } from '@/contexts/RouterContext/router.helpers';
import { HomePaths, MlPerfPaths, MmluPaths } from '@/contexts/RouterContext/router.paths';

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
    generatePath(join(MlPerfPaths.ROOT_PATH, MlPerfPaths.RESULT_PATH), { id: id.toString() })
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
    generatePath(join(MmluPaths.ROOT_PATH, MmluPaths.RESULT_PATH), { id: id.toString() })
} as const;
