import { lazy } from 'react';
import { Navigate, useRoutes } from 'react-router-dom';

import {
  HomePageLinks,
  MmluPageLinks,
  MpExamPageLinks
} from '@/contexts/RouterContext/router.links.ts';
import { MlPerfPaths, MmluPaths } from '@/contexts/RouterContext/router.paths.ts';

// ----------------------------------------------------------------------

const MMLUPage = lazy(() => import('@/pages/mmlu/main'));
const ComparisonPage = lazy(() => import('@/pages/mlperf/test-comparison/ComparisonPage'));
const TestResultPage = lazy(() => import('@/pages/mlperf/test-result'));

const MLPerfPage = lazy(() => import('@/pages/mlperf/main'));
const MMLUTestComparisonPage = lazy(() => import('@/pages/mmlu/test-comparison'));
const MMLUTestResultPage = lazy(() => import('@/pages/mmlu/test-result'));

// ----------------------------------------------------------------------

const NotFoundPage = () => {
  return <h1>Not found page</h1>;
};

// ----------------------------------------------------------------------

export const Routes = () => {
  return useRoutes([
    {
      path: HomePageLinks.main,
      element: <Navigate to={MpExamPageLinks.main} replace />
    },

    // mp exam pages
    {
      path: MpExamPageLinks.main,
      children: [
        {
          index: true,
          element: <MLPerfPage />
        },
        {
          path: MlPerfPaths.COMPARISON_PATH,
          element: <ComparisonPage />
        },
        {
          path: MlPerfPaths.RESULT_PATH,
          element: <TestResultPage />
        }
      ]
    },

    // mmlu exam pages
    {
      path: MmluPageLinks.main,
      children: [
        {
          index: true,
          element: <MMLUPage />
        },
        {
          path: MmluPaths.COMPARISON_PATH,
          element: <MMLUTestComparisonPage />
        },
        {
          path: MmluPaths.RESULT_PATH,
          element: <MMLUTestResultPage />
        }
      ]
    },

    // not found pages
    {
      path: '*',
      element: <NotFoundPage />,
      children: [
        { path: '404', element: <NotFoundPage /> },
        { path: '*', element: <Navigate to="/404" replace /> }
      ]
    },

    { path: '*', element: <Navigate to="/404" replace /> }
  ]);
};
