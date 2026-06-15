import { useMemo } from 'react';

import { Box, Chip, Divider, Typography } from '@mui/material';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

import { BarGraph } from '@/components/Graphs/BarGraph';
import { TestResultInfo } from '@/components/TestResultInfo';
import { TIMEZONE } from '@/constants/timezone.constants.ts';

import { useMmExamTestDetails } from '@/pages/mmlu/test-comparison/useMmExamTestDetails';
import { FairnessBanner } from '@/pages/mlperf/test-comparison/components/FairnessBanner';

// ----------------------------------------------------------------------

dayjs.extend(utc);
dayjs.extend(timezone);

// ----------------------------------------------------------------------

type GraphDatasets = Array<{
  id1: number;
  id2: number;
  resultNumber1: number;
  resultNumber2: number;
  datasets: Array<{ label: string; test1: number | string; test2: number | string }>;
}>;

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

const TestComparisonPage = () => {
  const { firstTestResult, secondTestResult } = useMmExamTestDetails();

  const comparisonGraphData = useMemo(() => {
    if (
      firstTestResult &&
      secondTestResult &&
      secondTestResult.results.length > 0 &&
      firstTestResult.results.length > 0
    ) {
      const data: GraphDatasets = [];

      const list1 = firstTestResult.results;
      const list2 = secondTestResult.results;

      for (let i = 0; i < list1.length; i++) {
        for (let j = 0; j < list2.length; j++) {
          data.push({
            id1: list1[i].id,
            id2: list2[j].id,
            resultNumber1: list1[i].result_number,
            resultNumber2: list2[j].result_number,
            datasets: [
              {
                label: 'Physics',
                test1: (list1[i].result_acc_physics ?? 0) * 100,
                test2: (list2[j].result_acc_physics ?? 0) * 100
              },
              {
                label: 'Chemistry',
                test1: (list1[i].result_acc_chemistry ?? 0) * 100,
                test2: (list2[j].result_acc_chemistry ?? 0) * 100
              },
              {
                label: 'Law',
                test1: (list1[i].result_acc_law ?? 0) * 100,
                test2: (list2[j].result_acc_law ?? 0) * 100
              },
              {
                label: 'Engineering',
                test1: (list1[i].result_acc_engineering ?? 0) * 100,
                test2: (list2[j].result_acc_engineering ?? 0) * 100
              },
              {
                label: 'Economics',
                test1: (list1[i].result_acc_economics ?? 0) * 100,
                test2: (list2[j].result_acc_economics ?? 0) * 100
              },
              {
                label: 'Health',
                test1: (list1[i].result_acc_health ?? 0) * 100,
                test2: (list2[j].result_acc_health ?? 0) * 100
              },
              {
                label: 'Psychology',
                test1: (list1[i].result_acc_psychology ?? 0) * 100,
                test2: (list2[j].result_acc_psychology ?? 0) * 100
              },
              {
                label: 'Business',
                test1: (list1[i].result_acc_business ?? 0) * 100,
                test2: (list2[j].result_acc_business ?? 0) * 100
              },
              {
                label: 'Biology',
                test1: (list1[i].result_acc_biology ?? 0) * 100,
                test2: (list2[j].result_acc_biology ?? 0) * 100
              },
              {
                label: 'Philosophy',
                test1: (list1[i].result_acc_philosophy ?? 0) * 100,
                test2: (list2[j].result_acc_philosophy ?? 0) * 100
              },
              {
                label: 'C-Science',
                test1: (list1[i].result_acc_cs ?? 0) * 100,
                test2: (list2[j].result_acc_cs ?? 0) * 100
              },
              {
                label: 'History',
                test1: (list1[i].result_acc_history ?? 0) * 100,
                test2: (list2[j].result_acc_history ?? 0) * 100
              },
              {
                label: 'Math',
                test1: (list1[i].result_acc_math ?? 0) * 100,
                test2: (list2[j].result_acc_math ?? 0) * 100
              },
              {
                label: 'Other',
                test1: (list1[i].result_acc_other ?? 0) * 100,
                test2: (list2[j].result_acc_other ?? 0) * 100
              },
              // bug #25: include the overall ("All") subject — present on the result page
              // but previously omitted here — so the comparison matches the per-run view.
              {
                label: 'All',
                test1: (list1[i].result_acc_total ?? 0) * 100,
                test2: (list2[j].result_acc_total ?? 0) * 100
              }
            ]
          });
        }
      }

      return data;
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
          MMLU-Pro Test Comparison
        </Typography>
        <Typography sx={{ fontSize: '0.875rem', color: '#64748B' }}>
          Side-by-side accuracy analysis across subject domains
        </Typography>
      </Box>

      {/* F3: fairness banner */}
      <FairnessBanner
        benchmark="mmlu"
        idA={firstTestResult.id}
        idB={secondTestResult.id}
        fallbackA={{
          precision: firstTestResult.precision,
          model: firstTestResult.model,
          dataset: firstTestResult.dataset,
          data_number: firstTestResult.data_number,
          max_output_tokens: firstTestResult.max_tokens ?? null
        }}
        fallbackB={{
          precision: secondTestResult.precision,
          model: secondTestResult.model,
          dataset: secondTestResult.dataset,
          data_number: secondTestResult.data_number,
          max_output_tokens: secondTestResult.max_tokens ?? null
        }}
      />

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
              label="MMLU-Pro"
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
            examType={{ label: 'Type of exam', value: 'MMLU-Pro' }}
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
              label="MMLU-Pro"
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
            examType={{ label: 'Type of exam', value: 'MMLU-Pro' }}
            model={{ label: 'Model', value: secondTestResult.model }}
            gpu={{ label: 'GPU', value: `${secondTestResult.gpu_type} x${secondTestResult.gpu_num}` }}
            numberOfRepetition={secondTestResult.retry_num}
            dataset={{ label: 'Dataset', value: secondTestResult.dataset }}
            precision={{ label: 'Precision', value: secondTestResult.precision }}
            cpu={{ label: 'CPU', value: secondTestResult.cpu_core }}
            startTime={{
              label: 'Start time',
              value: dayjs(secondTestResult.started_at).tz(TIMEZONE).format('YYYY-MM-DD HH:mm')
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
      {comparisonGraphData && (
        <Box>
          <Divider sx={{ marginBottom: '2rem', borderColor: '#E2E8F0' }} />

          {/* Section header */}
          <Box sx={{ marginBottom: '1.75rem' }}>
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
                  letterSpacing: '-0.02em'
                }}
              >
                Accuracy Comparison Graph
              </Typography>
            </Box>
            <Typography sx={{ fontSize: '0.8125rem', color: '#64748B', paddingLeft: '1rem' }}>
              {firstTestResult.name} vs {secondTestResult.name} — subject-level breakdown
            </Typography>
          </Box>

          {/* One card per repetition pair */}
          {comparisonGraphData.map(item => (
            <Box
              key={`${item.id1}-${item.id2}`}
              sx={{
                backgroundColor: '#FFFFFF',
                border: '1px solid #E2E8F0',
                borderRadius: '0.75rem',
                boxShadow: '0 1px 3px 0 rgba(0,0,0,0.06)',
                padding: '1.75rem 2rem',
                marginBottom: '1.5rem'
              }}
            >
              {/* Repetition pair label */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
                <Chip
                  label={`Repetition ${item.resultNumber1} × ${item.resultNumber2}`}
                  size="small"
                  sx={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    height: 24,
                    background: 'linear-gradient(135deg, #EEF2FF 0%, #E0E7FF 100%)',
                    color: '#4F46E5',
                    border: '1px solid #C7D2FE'
                  }}
                />
                <Box sx={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                    <Box sx={{ width: 10, height: 10, borderRadius: '50%', background: 'linear-gradient(135deg, #4F46E5 0%, #6366F1 100%)' }} />
                    <Typography sx={{ fontSize: '0.75rem', color: '#475569', fontWeight: 500 }}>
                      {firstTestResult.name}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                    <Box sx={{ width: 10, height: 10, borderRadius: '50%', background: 'linear-gradient(135deg, #0EA5E9 0%, #38BDF8 100%)' }} />
                    <Typography sx={{ fontSize: '0.75rem', color: '#475569', fontWeight: 500 }}>
                      {secondTestResult.name}
                    </Typography>
                  </Box>
                </Box>
              </Box>

              <BarGraph
                dataset={item.datasets}
                xAxis={[{ dataKey: 'label' }]}
                series={[
                  {
                    dataKey: 'test1',
                    label: `${firstTestResult.name} (Repetition ${item.resultNumber1})`,
                    valueFormatter: value => `${value}%`
                  },
                  {
                    dataKey: 'test2',
                    label: `${secondTestResult.name} (Repetition ${item.resultNumber2})`,
                    valueFormatter: value => `${value}%`
                  }
                ]}
                yAxis={[{ label: 'Accuracy rate (%)', width: 60 }]}
                sx={{
                  '& .MuiChartsLabel-root.MuiChartsLegend-label': {
                    fontSize: '1.25rem',
                    fontWeight: 500
                  }
                }}
              />
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
};

export default TestComparisonPage;
