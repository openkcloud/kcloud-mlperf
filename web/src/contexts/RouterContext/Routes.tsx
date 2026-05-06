import { lazy, Suspense } from 'react';
import { Link, Navigate, useRoutes } from 'react-router-dom';

import { Alert, Button, Container, Typography } from '@mui/material';

import {
  AdminPageLinks,
  DashboardPageLinks,
  HomePageLinks,
  MmluPageLinks,
  MpExamPageLinks,
  NpuEvalPageLinks,
  NpuEvalRngdPageLinks,
  NpuEvalAtomPlusPageLinks
} from '@/contexts/RouterContext/router.links.ts';
import { MlPerfPaths, MmluPaths, NpuEvalPaths, NpuEvalRngdPaths, NpuEvalAtomPlusPaths } from '@/contexts/RouterContext/router.paths.ts';

// ----------------------------------------------------------------------

const MMLUPage = lazy(() => import('@/pages/mmlu/main'));
const ComparisonPage = lazy(() => import('@/pages/mlperf/test-comparison/ComparisonPage'));
const TestResultPage = lazy(() => import('@/pages/mlperf/test-result'));

const MLPerfPage = lazy(() => import('@/pages/mlperf/main'));
const MMLUTestComparisonPage = lazy(() => import('@/pages/mmlu/test-comparison'));
const MMLUTestResultPage = lazy(() => import('@/pages/mmlu/test-result'));

const HomePage = lazy(() => import('@/pages/home/HomePage'));
const NpuEvalPage = lazy(() => import('@/pages/npu/main'));
const NpuTestResultPage = lazy(() => import('@/pages/npu/test-result'));
const NpuComparisonPage = lazy(() => import('@/pages/npu/test-comparison'));
const DeviceComparisonPage = lazy(() => import('@/pages/npu/device-comparison'));

const RngdNpuEvalPage = lazy(() => import('@/pages/npu-eval/rngd'));
const RngdDeviceComparisonPage = lazy(() => import('@/pages/npu-eval/rngd/device-comparison'));

const AtomPlusNpuEvalPage = lazy(() => import('@/pages/npu-eval/atomplus'));
const AtomPlusDeviceComparisonPage = lazy(() => import('@/pages/npu-eval/atomplus/device-comparison'));

const GpuRealtimePage = lazy(() => import('@/pages/dashboard/gpu-realtime'));
const NpuRealtimePage = lazy(() => import('@/pages/dashboard/npu-realtime'));
const SweepControlPage = lazy(() => import('@/pages/dashboard/sweep-control'));
const MlperfDeviceComparisonPage = lazy(() => import('@/pages/mlperf/device-comparison'));
const MmluDeviceComparisonPage = lazy(() => import('@/pages/mmlu/device-comparison'));

// ----------------------------------------------------------------------

const AdminSweepControlPage = () => (
  <>
    <Alert severity="info" sx={{ mb: 3 }}>
      <Typography fontWeight={700} component="span">Admin-only page.</Typography>{' '}
      Sweep Control is not accessible from the main navigation. This page is intended for operators only.
    </Alert>
    <Suspense>
      <SweepControlPage />
    </Suspense>
  </>
);

// ----------------------------------------------------------------------

const NotFoundPage = () => (
  <Container maxWidth="sm" sx={{ py: 12, textAlign: 'center' }}>
    <Typography variant="h1" sx={{ fontSize: '6rem', fontWeight: 700, color: 'text.disabled' }}>404</Typography>
    <Typography variant="h5" sx={{ mt: 2 }}>Page not found</Typography>
    <Typography variant="body1" sx={{ mt: 1, color: 'text.secondary' }}>The page you're looking for doesn't exist or has moved.</Typography>
    <Button component={Link} to="/" variant="contained" sx={{ mt: 4 }}>Go home</Button>
  </Container>
);

// ----------------------------------------------------------------------

export const Routes = () => {
  return useRoutes([
    {
      path: HomePageLinks.main,
      element: <HomePage />
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
        },
        {
          path: MlPerfPaths.DEVICE_COMPARISON_PATH,
          element: <MlperfDeviceComparisonPage />
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
        },
        {
          path: MmluPaths.DEVICE_COMPARISON_PATH,
          element: <MmluDeviceComparisonPage />
        }
      ]
    },

    // npu eval pages
    {
      path: NpuEvalPageLinks.main,
      children: [
        {
          index: true,
          element: <NpuEvalPage />
        },
        {
          path: NpuEvalPaths.COMPARISON_PATH,
          element: <NpuComparisonPage />
        },
        {
          path: NpuEvalPaths.RESULT_PATH,
          element: <NpuTestResultPage />
        },
        {
          path: NpuEvalPaths.DEVICE_COMPARISON_PATH,
          element: <DeviceComparisonPage />
        }
      ]
    },

    // npu-eval/rngd pages
    {
      path: NpuEvalRngdPageLinks.main,
      children: [
        {
          index: true,
          element: <RngdNpuEvalPage />
        },
        {
          path: NpuEvalRngdPaths.DEVICE_COMPARISON_PATH,
          element: <RngdDeviceComparisonPage />
        }
      ]
    },

    // npu-eval/atomplus pages
    {
      path: NpuEvalAtomPlusPageLinks.main,
      children: [
        {
          index: true,
          element: <AtomPlusNpuEvalPage />
        },
        {
          path: NpuEvalAtomPlusPaths.DEVICE_COMPARISON_PATH,
          element: <AtomPlusDeviceComparisonPage />
        }
      ]
    },

    // dashboard pages
    {
      path: DashboardPageLinks.gpuRealtime,
      element: <GpuRealtimePage />
    },
    {
      path: DashboardPageLinks.npuRealtime,
      element: <NpuRealtimePage />
    },
    {
      path: DashboardPageLinks.sweepControl,
      element: <Navigate to={AdminPageLinks.sweepControl} replace />
    },

    // admin pages
    {
      path: AdminPageLinks.sweepControl,
      element: <AdminSweepControlPage />
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
