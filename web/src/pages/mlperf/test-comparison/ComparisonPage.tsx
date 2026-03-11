import { Fragment, useMemo, useState } from 'react';

import { Box, Button, Chip, Divider, Typography } from '@mui/material';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

import { TestResultInfo } from '@/components/TestResultInfo';
import { TIMEZONE } from '@/constants/timezone.constants';
import { MpExamModeEnum } from '@/enums/mp-exam-mode.enum';

import { useTestDetails } from '@/pages/mlperf/test-comparison/useTestDetails';

import { AccuracyComparisonGraph } from '@/pages/mlperf/test-comparison/components/AccuracyComparisonGraph';
import { PerformanceComparisonGraph } from '@/pages/mlperf/test-comparison/components/PerformanceComparisonGraph';

// ----------------------------------------------------------------------

dayjs.extend(utc);
dayjs.extend(timezone);

// ----------------------------------------------------------------------

const CARD_BASE = {
  borderRadius: '0.75rem',
  border: '1px solid',
  backgroundColor: '#FFFFFF',
  boxShadow: '0 1px 3px 0 rgba(0,0,0,0.08), 0 1px 2px -1px rgba(0,0,0,0.06)',
  padding: '1.75rem 2rem',
  marginBottom: '1.5rem'
};

// ----------------------------------------------------------------------

const ComparisonPage = () => {
  const { firstTestResult, secondTestResult } = useTestDetails();

  const [state, setState] = useState<{ rn1: number; rn2: number }>({ rn1: 1, rn2: 1 });

  const repetitionCounts = useMemo(() => {
    const isValid =
      firstTestResult &&
      secondTestResult &&
      firstTestResult.results.length > 0 &&
      secondTestResult.results.length > 0;

    if (isValid) {
      const countList: Array<{ id1: number; id2: number; resultNum1: number; resultNum2: number }> =
        [];
      const list1 = firstTestResult.results;
      const list2 = secondTestResult.results;
      for (let i = 0; i < list1.length; i++) {
        for (let j = 0; j < list2.length; j++) {
          countList.push({
            id1: list1[i].id,
            id2: list2[j].id,
            resultNum1: list1[i].result_number,
            resultNum2: list2[j].result_number
          });
        }
      }

      return countList;
    }

    return null;
  }, [firstTestResult, secondTestResult]);

  if (!firstTestResult || !secondTestResult) return null;

  return (
    <Box padding={'2.5rem'} sx={{ backgroundColor: '#F8FAFC', minHeight: '100vh' }}>

      {/* Page header */}
      <Box sx={{ marginBottom: '2rem' }}>
        <Typography
          component={'h1'}
          sx={{
            fontSize: '1.5rem',
            fontWeight: 700,
            color: '#0F172A',
            letterSpacing: '-0.025em',
            marginBottom: '0.375rem'
          }}
        >
          MLPerf Test Comparison
        </Typography>
        <Typography sx={{ fontSize: '0.875rem', color: '#64748B' }}>
          Side-by-side analysis of two MLPerf benchmark runs
        </Typography>
      </Box>

      {/* Test cards — side-by-side at lg, stacked below */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' },
          gap: '1.5rem',
          marginBottom: '2rem'
        }}
      >
        {/* Test 1 card — indigo accent */}
        <Box
          sx={{
            ...CARD_BASE,
            borderColor: '#C7D2FE',
            borderLeft: '4px solid #4F46E5'
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <Box
              sx={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #4F46E5 0%, #6366F1 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontSize: '0.75rem',
                fontWeight: 700,
                flexShrink: 0
              }}
            >
              1
            </Box>
            <Typography sx={{ fontSize: '1rem', fontWeight: 600, color: '#1E293B' }}>
              Test A
            </Typography>
            <Chip
              label="MLPerf"
              size="small"
              sx={{
                ml: 'auto',
                fontSize: '0.6875rem',
                fontWeight: 600,
                height: 22,
                background: 'linear-gradient(135deg, #EEF2FF 0%, #E0E7FF 100%)',
                color: '#4F46E5',
                border: '1px solid #C7D2FE'
              }}
            />
          </Box>
          <TestResultInfo
            order={1}
            name={firstTestResult.name}
            description={firstTestResult.description}
            examType={{ label: 'Type of exam', value: 'MLPerf' }}
            model={{ label: 'Model', value: firstTestResult.model }}
            gpu={{ label: 'GPU', value: `${firstTestResult.gpu_type} x${firstTestResult.gpu_num}` }}
            numberOfRepetition={firstTestResult.retry_num}
            dataset={{ label: 'Dataset', value: firstTestResult.dataset }}
            precision={{ label: 'Precision', value: firstTestResult.precision }}
            cpu={{ label: 'CPU', value: firstTestResult.cpu_core }}
            startTime={{
              label: 'Start time',
              value: dayjs(firstTestResult.started_at).format('YYYY-MM-DD HH:mm')
            }}
            dataNumber={{ label: 'Number of data', value: firstTestResult.data_number || 'Full' }}
            framework={{ label: 'Framework', value: firstTestResult.framework }}
            ram={{ label: 'RAM', value: firstTestResult.ram_capacity }}
            endTime={{
              label: 'End time',
              value: dayjs(firstTestResult.end_at).tz(TIMEZONE).format('YYYY-MM-DD HH:mm')
            }}
          />
        </Box>

        {/* Test 2 card — sky accent */}
        <Box
          sx={{
            ...CARD_BASE,
            borderColor: '#BAE6FD',
            borderLeft: '4px solid #0EA5E9'
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <Box
              sx={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #0EA5E9 0%, #38BDF8 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontSize: '0.75rem',
                fontWeight: 700,
                flexShrink: 0
              }}
            >
              2
            </Box>
            <Typography sx={{ fontSize: '1rem', fontWeight: 600, color: '#1E293B' }}>
              Test B
            </Typography>
            <Chip
              label="MLPerf"
              size="small"
              sx={{
                ml: 'auto',
                fontSize: '0.6875rem',
                fontWeight: 600,
                height: 22,
                background: 'linear-gradient(135deg, #F0F9FF 0%, #E0F2FE 100%)',
                color: '#0EA5E9',
                border: '1px solid #BAE6FD'
              }}
            />
          </Box>
          <TestResultInfo
            order={2}
            name={secondTestResult.name}
            description={secondTestResult.description}
            examType={{ label: 'Type of exam', value: 'MLPerf' }}
            model={{ label: 'Model', value: secondTestResult.model }}
            gpu={{ label: 'GPU', value: `${secondTestResult.gpu_type} x${secondTestResult.gpu_num}` }}
            numberOfRepetition={secondTestResult.retry_num}
            dataset={{ label: 'Dataset', value: secondTestResult.dataset }}
            precision={{ label: 'Precision', value: secondTestResult.precision }}
            cpu={{ label: 'CPU', value: secondTestResult.cpu_core }}
            startTime={{
              label: 'Start time',
              value: dayjs(secondTestResult.started_at).format('YYYY-MM-DD HH:mm')
            }}
            dataNumber={{ label: 'Number of data', value: secondTestResult.data_number || 'Full' }}
            framework={{ label: 'Framework', value: secondTestResult.framework }}
            ram={{ label: 'RAM', value: secondTestResult.ram_capacity }}
            endTime={{
              label: 'End time',
              value: dayjs(secondTestResult.end_at).tz(TIMEZONE).format('YYYY-MM-DD HH:mm')
            }}
          />
        </Box>
      </Box>

      {/* Comparison graph section */}
      {repetitionCounts && (
        <Fragment>
          <Divider sx={{ marginBottom: '2rem', borderColor: '#E2E8F0' }} />

          {/* Section header */}
          <Box sx={{ marginBottom: '1.5rem' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <Box
                sx={{
                  width: 4,
                  height: 28,
                  borderRadius: '2px',
                  background: 'linear-gradient(180deg, #4F46E5 0%, #0EA5E9 100%)'
                }}
              />
              <Typography
                component={'h3'}
                sx={{
                  fontSize: '1.25rem',
                  fontWeight: 700,
                  color: '#0F172A',
                  letterSpacing: '-0.02em',
                  textTransform: 'capitalize'
                }}
              >
                {firstTestResult.mode} Comparison Graph
              </Typography>
            </Box>
            <Typography sx={{ fontSize: '0.8125rem', color: '#64748B', paddingLeft: '1rem' }}>
              {firstTestResult.name.toUpperCase()} vs {secondTestResult.name.toUpperCase()}
            </Typography>
          </Box>

          {/* Repetition selector */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              marginBottom: '2rem',
              flexWrap: 'wrap'
            }}
          >
            <Typography sx={{ fontSize: '0.8125rem', fontWeight: 500, color: '#475569', marginRight: '0.25rem' }}>
              Repetition pair:
            </Typography>
            {repetitionCounts.map(item => {
              const isActive = state.rn1 === item.resultNum1 && state.rn2 === item.resultNum2;
              return (
                <Button
                  key={`${item.id1}-${item.id2}`}
                  size="small"
                  onClick={() => setState({ rn1: item.resultNum1, rn2: item.resultNum2 })}
                  sx={{
                    fontSize: '0.8125rem',
                    fontWeight: 600,
                    height: 34,
                    px: 2,
                    borderRadius: '0.5rem',
                    textTransform: 'none',
                    ...(isActive
                      ? {
                          background: 'linear-gradient(135deg, #4F46E5 0%, #6366F1 100%)',
                          color: '#FFFFFF',
                          boxShadow: '0 1px 3px 0 rgba(79,70,229,0.3)',
                          '&:hover': {
                            background: 'linear-gradient(135deg, #4338CA 0%, #4F46E5 100%)'
                          }
                        }
                      : {
                          border: '1.5px solid #E2E8F0',
                          color: '#475569',
                          backgroundColor: '#FFFFFF',
                          '&:hover': {
                            borderColor: '#4F46E5',
                            backgroundColor: 'rgba(79,70,229,0.04)',
                            color: '#4F46E5'
                          }
                        })
                  }}
                >
                  ({item.resultNum1}) × ({item.resultNum2})
                </Button>
              );
            })}
          </Box>
        </Fragment>
      )}

      {/* Graph panels */}
      {repetitionCounts &&
        firstTestResult.mode === MpExamModeEnum.ACCURACY &&
        secondTestResult.mode === MpExamModeEnum.ACCURACY && (
          <Box
            sx={{
              backgroundColor: '#FFFFFF',
              border: '1px solid #E2E8F0',
              borderRadius: '0.75rem',
              boxShadow: '0 1px 3px 0 rgba(0,0,0,0.06)',
              padding: '1.75rem 2rem'
            }}
          >
            <AccuracyComparisonGraph
              result1={{
                result_acc_rg_1: firstTestResult.results[state.rn1 - 1].result_acc_rg_1,
                result_acc_rg_2: firstTestResult.results[state.rn1 - 1].result_acc_rg_2,
                result_acc_rg_l: firstTestResult.results[state.rn1 - 1].result_acc_rg_l,
                result_acc_rg_lsum: firstTestResult.results[state.rn1 - 1].result_acc_rg_lsum,
                result_number: state.rn1
              }}
              result2={{
                result_acc_rg_1: secondTestResult.results[state.rn2 - 1].result_acc_rg_1,
                result_acc_rg_2: secondTestResult.results[state.rn2 - 1].result_acc_rg_2,
                result_acc_rg_l: secondTestResult.results[state.rn2 - 1].result_acc_rg_l,
                result_acc_rg_lsum: secondTestResult.results[state.rn2 - 1].result_acc_rg_lsum,
                result_number: state.rn2
              }}
            />
          </Box>
        )}
      {repetitionCounts &&
        firstTestResult.mode === MpExamModeEnum.PERFORMANCE &&
        secondTestResult.mode === MpExamModeEnum.PERFORMANCE && (
          <Box
            sx={{
              backgroundColor: '#FFFFFF',
              border: '1px solid #E2E8F0',
              borderRadius: '0.75rem',
              boxShadow: '0 1px 3px 0 rgba(0,0,0,0.06)',
              padding: '1.75rem 2rem'
            }}
          >
            <PerformanceComparisonGraph
              result1={{
                result_gpu_util: firstTestResult.results[state.rn1 - 1].result_gpu_util,
                result_perf_tps_best: firstTestResult.results[state.rn1 - 1].result_perf_tps_best,
                result_perf_tps: firstTestResult.results[state.rn1 - 1].result_perf_tps,
                result_perf_serv_tpot: firstTestResult.results[state.rn1 - 1].result_perf_serv_tpot,
                result_perf_serv_ttft: firstTestResult.results[state.rn1 - 1].result_perf_serv_ttft,
                result_vram_peak: firstTestResult.results[state.rn1 - 1].result_vram_peak,
                gpu_type: firstTestResult.gpu_type,
                result_tt100t: firstTestResult.results[state.rn1 - 1].result_tt100t,
                result_perf_latency: firstTestResult.results[state.rn1 - 1].result_perf_latency,
                result_perf_sps: firstTestResult.results[state.rn1 - 1].result_perf_sps,
                test_scenario: firstTestResult.scenario,
                test_name: firstTestResult.name
              }}
              result2={{
                result_gpu_util: secondTestResult.results[state.rn2 - 1].result_gpu_util,
                result_perf_tps_best: secondTestResult.results[state.rn2 - 1].result_perf_tps_best,
                result_perf_tps: secondTestResult.results[state.rn2 - 1].result_perf_tps,
                result_perf_serv_tpot: secondTestResult.results[state.rn2 - 1].result_perf_serv_tpot,
                result_perf_serv_ttft: secondTestResult.results[state.rn2 - 1].result_perf_serv_ttft,
                result_vram_peak: secondTestResult.results[state.rn2 - 1].result_vram_peak,
                gpu_type: secondTestResult.gpu_type,
                result_tt100t: secondTestResult.results[state.rn2 - 1].result_tt100t,
                result_perf_latency: secondTestResult.results[state.rn2 - 1].result_perf_latency,
                result_perf_sps: secondTestResult.results[state.rn2 - 1].result_perf_sps,
                test_scenario: secondTestResult.scenario,
                test_name: secondTestResult.name
              }}
            />
          </Box>
        )}
    </Box>
  );
};

export default ComparisonPage;
