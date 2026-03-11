import { Fragment, useState } from 'react';

import { AverageAccuracyExamGraph } from './components/AverageAccuracyExamGraph';
import { AveragePerformanceExamGraph } from './components/AveragePerformanceExamGraph';
import { Box, Button, Typography } from '@mui/material';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

import { DownloadButton } from '@/components/DownloadButton';
import { TestResultInfo } from '@/components/TestResultInfo';
import { TIMEZONE } from '@/constants/timezone.constants';
import { MpExamModeEnum } from '@/enums/mp-exam-mode.enum';

import { useTestResult } from '@/pages/mlperf/test-result/useTestResult';

import { AccuracyExamGraph } from '@/pages/mlperf/test-result/components/AccuracyExamGraph';
import { PerformanceExamGraph } from '@/pages/mlperf/test-result/components/PerformanceExamGraph';

// ----------------------------------------------------------------------

dayjs.extend(utc);
dayjs.extend(timezone);

// ----------------------------------------------------------------------

const TestResultPage = () => {
  const testResult = useTestResult();
  console.log('testResult:', testResult);

  const [activeIndex, setActiveIndex] = useState<number>(1);
  const [showAverageAccuracyGraph, setShowAverageAccuracyGraph] = useState<boolean>(false);

  if (!testResult) return null;

  return (
    <Box sx={{ p: 3, width: '100%' }}>
      <TestResultInfo
        order={1}
        name={testResult.name}
        description={testResult.description}
        examType={{
          label: 'Type of exam',
          value: 'MLPerf'
        }}
        model={{
          label: 'Model',
          value: testResult.model
        }}
        gpu={{
          label: 'GPU',
          value: `${testResult.gpu_type} x${testResult.gpu_num}`
        }}
        numberOfRepetition={testResult.retry_num}
        dataset={{
          label: 'Dataset',
          value: testResult.dataset
        }}
        precision={{
          label: 'Precision',
          value: testResult.precision
        }}
        cpu={{
          label: 'CPU',
          value: testResult.cpu_core
        }}
        startTime={{
          label: 'Start time',
          value: dayjs(testResult.started_at).format('YYYY-MM-DD HH:mm')
        }}
        dataNumber={{
          label: 'Number of data',
          value: testResult.data_number || 'Full'
        }}
        framework={{
          label: 'Framework',
          value: testResult.framework
        }}
        ram={{
          label: 'RAM',
          value: testResult.ram_capacity
        }}
        endTime={{
          label: 'End time',
          value: dayjs(testResult.end_at).tz(TIMEZONE).format('YYYY-MM-DD HH:mm')
        }}
      />
      {testResult.results.length > 0 && (
        <Fragment>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '2rem', marginBottom: '2.5rem' }}>
            <Typography
              component={'h3'}
              fontWeight={700}
              fontSize={'1.5rem'}
              textTransform={'capitalize'}
              sx={{ color: '#1E293B', letterSpacing: '-0.02em' }}
            >
              {testResult.name} {testResult.mode} graph
            </Typography>
            <Box
              sx={{
                display: 'flex',
                gap: '1rem',
                marginLeft: 'auto'
              }}
            >
              <DownloadButton
                url={`${import.meta.env.VITE__APP_API_BASE_URL}/mp-exam-result/exam-result/${testResult.id}/${activeIndex}/download`}
                label={'Exam Result'}
              />
              <DownloadButton
                url={`${import.meta.env.VITE__APP_API_BASE_URL}/mp-exam-result/exam-submission/${testResult.id}/${activeIndex}/download`}
                label={'Submission Report'}
              />
            </Box>
          </Box>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              mb: 3,
              p: 0.5,
              bgcolor: '#F1F5F9',
              borderRadius: '0.625rem',
              width: 'fit-content'
            }}
          >
            {testResult.results.map(result => {
              const isActive = !showAverageAccuracyGraph && activeIndex === result.result_number;
              return (
                <Button
                  key={result.id}
                  variant="text"
                  onClick={() => {
                    setActiveIndex(result.result_number);
                    setShowAverageAccuracyGraph(false);
                  }}
                  sx={{
                    borderRadius: '0.5rem',
                    px: 2.5,
                    py: 0.75,
                    fontSize: '0.8125rem',
                    fontWeight: 600,
                    textTransform: 'none',
                    color: isActive ? '#FFF' : '#64748B',
                    background: isActive ? 'linear-gradient(135deg, #4F46E5 0%, #6366F1 100%)' : 'transparent',
                    boxShadow: isActive ? '0 2px 4px rgba(79, 70, 229, 0.25)' : 'none',
                    '&:hover': {
                      background: isActive ? 'linear-gradient(135deg, #4338CA 0%, #4F46E5 100%)' : 'rgba(79, 70, 229, 0.06)'
                    }
                  }}
                >
                  Rep {result.result_number}
                </Button>
              );
            })}
            {testResult.results.length > 1 && (
              <Button
                variant="text"
                onClick={() => {
                  setShowAverageAccuracyGraph(true);
                }}
                sx={{
                  borderRadius: '0.5rem',
                  px: 2.5,
                  py: 0.75,
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  textTransform: 'none',
                  color: showAverageAccuracyGraph ? '#FFF' : '#64748B',
                  background: showAverageAccuracyGraph ? 'linear-gradient(135deg, #0EA5E9 0%, #38BDF8 100%)' : 'transparent',
                  boxShadow: showAverageAccuracyGraph ? '0 2px 4px rgba(14, 165, 233, 0.25)' : 'none',
                  '&:hover': {
                    background: showAverageAccuracyGraph ? 'linear-gradient(135deg, #0284C7 0%, #0EA5E9 100%)' : 'rgba(14, 165, 233, 0.06)'
                  }
                }}
              >
                Average
              </Button>
            )}
          </Box>
          {testResult.mode === MpExamModeEnum.ACCURACY &&
            (!showAverageAccuracyGraph ? (
              <AccuracyExamGraph
                key={activeIndex}
                result_number={activeIndex}
                result_acc_rg_1={testResult.results[activeIndex - 1].result_acc_rg_1}
                result_acc_rg_2={testResult.results[activeIndex - 1].result_acc_rg_2}
                result_acc_rg_l={testResult.results[activeIndex - 1].result_acc_rg_l}
                result_acc_rg_lsum={testResult.results[activeIndex - 1].result_acc_rg_lsum}
              />
            ) : (
              <AverageAccuracyExamGraph
                repetitionCount={testResult.results.length}
                result_acc_rg_1={
                  testResult.results.reduce(
                    (sum, result) => sum + (result.result_acc_rg_1 ?? 0),
                    0
                  ) / testResult.results.length
                }
                result_acc_rg_2={
                  testResult.results.reduce(
                    (sum, result) => sum + (result.result_acc_rg_2 ?? 0),
                    0
                  ) / testResult.results.length
                }
                result_acc_rg_l={
                  testResult.results.reduce(
                    (sum, result) => sum + (result.result_acc_rg_l ?? 0),
                    0
                  ) / testResult.results.length
                }
                result_acc_rg_lsum={
                  testResult.results.reduce(
                    (sum, result) => sum + (result.result_acc_rg_lsum ?? 0),
                    0
                  ) / testResult.results.length
                }
              />
            ))}
          {testResult.mode === MpExamModeEnum.PERFORMANCE &&
            (!showAverageAccuracyGraph ? (
              <PerformanceExamGraph
                key={activeIndex}
                result_number={activeIndex}
                result_tt100t={testResult.results[activeIndex - 1].result_tt100t}
                test_scenario={testResult.scenario}
                result_perf_tps_best={testResult.results[activeIndex - 1].result_perf_tps_best}
                result_perf_tps={testResult.results[activeIndex - 1].result_perf_tps}
                result_vram_peak={testResult.results[activeIndex - 1].result_vram_peak}
                result_gpu_util={testResult.results[activeIndex - 1].result_gpu_util}
                result_perf_serv_tpot={testResult.results[activeIndex - 1].result_perf_serv_tpot}
                result_perf_serv_ttft={testResult.results[activeIndex - 1].result_perf_serv_ttft}
                result_perf_latency={testResult.results[activeIndex - 1].result_perf_latency}
                result_perf_sps={testResult.results[activeIndex - 1].result_perf_sps}
                result_perf_sps_best={testResult.results[activeIndex - 1].result_perf_sps_best}
                result_perf_valid={testResult.results[activeIndex - 1].result_perf_valid}
                gpu_type={testResult.gpu_type}
                test_name={testResult.name}
              />
            ) : (
              <AveragePerformanceExamGraph
                repetitionCount={testResult.results.length}
                test_scenario={testResult.scenario}
                // Averages over all repetitions
                result_number={0}
                result_perf_tps_best={
                  testResult.results.reduce(
                    (sum, result) => sum + (result.result_perf_tps_best ?? 0),
                    0
                  ) / testResult.results.length
                }
                result_perf_tps={
                  testResult.results.reduce(
                    (sum, result) => sum + (result.result_perf_tps ?? 0),
                    0
                  ) / testResult.results.length
                }
                result_perf_sps_best={
                  testResult.results.reduce(
                    (sum, result) => sum + (result.result_perf_sps_best ?? 0),
                    0
                  ) / testResult.results.length
                }
                result_perf_sps={
                  testResult.results.reduce(
                    (sum, result) => sum + (result.result_perf_sps ?? 0),
                    0
                  ) / testResult.results.length
                }
                result_perf_valid={null}
                result_tt100t={
                  testResult.results.reduce((sum, result) => sum + (result.result_tt100t ?? 0), 0) /
                  testResult.results.length
                }
                result_perf_latency={
                  testResult.results.reduce(
                    (sum, result) => sum + (result.result_perf_latency ?? 0),
                    0
                  ) / testResult.results.length
                }
                result_perf_serv_ttft={
                  testResult.results.reduce(
                    (sum, result) => sum + (result.result_perf_serv_ttft ?? 0),
                    0
                  ) / testResult.results.length
                }
                result_perf_serv_tpot={
                  testResult.results.reduce(
                    (sum, result) => sum + (result.result_perf_serv_tpot ?? 0),
                    0
                  ) / testResult.results.length
                }
                result_vram_peak={
                  testResult.results.reduce(
                    (sum, result) => sum + (result.result_vram_peak ?? 0),
                    0
                  ) / testResult.results.length
                }
                result_gpu_util={
                  testResult.results.reduce(
                    (sum, result) => sum + (result.result_gpu_util ?? 0),
                    0
                  ) / testResult.results.length
                }
                gpu_type={testResult.gpu_type}
                test_name={testResult.name}
              />
            ))}
        </Fragment>
      )}
    </Box>
  );
};

export default TestResultPage;
