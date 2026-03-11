import { useMemo } from 'react';

import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import { Box, Button, Typography } from '@mui/material';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import * as XLSX from 'xlsx';

import { BarGraph } from '@/components/Graphs/BarGraph';
import { TestResultInfo } from '@/components/TestResultInfo';
import { TIMEZONE } from '@/constants/timezone.constants.ts';

import { useMmExamTestResult } from '@/pages/mmlu/test-result/useMmExamTestResult';

// ----------------------------------------------------------------------

dayjs.extend(utc);
dayjs.extend(timezone);

// ----------------------------------------------------------------------

type TestResultGraphs = Array<{
  id: number;
  resultNumber: number;
  datasets: Array<{ label: string; accuracy: number | null; allAccuracy: number | null }>;
}>;

type AverageDatasets = Array<{ label: string; accuracy: number | null; allAccuracy: number | null }>;

// ----------------------------------------------------------------------

const TestResultPage = () => {
  const testResult = useMmExamTestResult();
  console.log('testResult of MMLU:', testResult?.results);

  const downloadExcel = () => {
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(testResult?.results || []);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    const excelBlob = new Blob([excelBuffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    const excelUrl = URL.createObjectURL(excelBlob);
    const link = document.createElement('a');
    link.href = excelUrl;
    link.download = 'MMLU-Pro Accuracy Test Results.xlsx';
    link.click();
  };

  console.log('testResult: ', testResult);

  const testResultGraphs: TestResultGraphs | null = useMemo(() => {
    if (!testResult || testResult.results.length === 0) return null;

    const data: TestResultGraphs = [];

    for (const result of testResult.results) {
      data.push({
        id: result.id,
        resultNumber: result.result_number,
        datasets: [
          { label: 'Physics', accuracy: (result.result_acc_physics ?? 0) * 100, allAccuracy: null },
          { label: 'Chemistry', accuracy: (result.result_acc_chemistry ?? 0) * 100, allAccuracy: null },
          { label: 'Law', accuracy: (result.result_acc_law ?? 0) * 100, allAccuracy: null },
          { label: 'Engineering', accuracy: (result.result_acc_engineering ?? 0) * 100, allAccuracy: null },
          { label: 'Economics', accuracy: (result.result_acc_economics ?? 0) * 100, allAccuracy: null },
          { label: 'Health', accuracy: (result.result_acc_health ?? 0) * 100, allAccuracy: null },
          { label: 'Psychology', accuracy: (result.result_acc_psychology ?? 0) * 100, allAccuracy: null },
          { label: 'Business', accuracy: (result.result_acc_business ?? 0) * 100, allAccuracy: null },
          { label: 'Biology', accuracy: (result.result_acc_biology ?? 0) * 100, allAccuracy: null },
          { label: 'Philosophy', accuracy: (result.result_acc_philosophy ?? 0) * 100, allAccuracy: null },
          { label: 'C-Science', accuracy: (result.result_acc_cs ?? 0) * 100, allAccuracy: null },
          { label: 'History', accuracy: (result.result_acc_history ?? 0) * 100, allAccuracy: null },
          { label: 'Math', accuracy: (result.result_acc_math ?? 0) * 100, allAccuracy: null },
          { label: 'Other', accuracy: (result.result_acc_other ?? 0) * 100, allAccuracy: null },
          { label: 'All', accuracy: null, allAccuracy: (result.result_acc_total ?? 0) * 100 }
        ]
      });
    }

    return data;
  }, [testResult]);

  const averageDatasets: AverageDatasets | null = useMemo(() => {
    if (!testResult || testResult.results.length === 0) return null;

    const { results } = testResult;
    const count = results.length;

    const sums = results.reduce(
      (acc, result) => ({
        physics: acc.physics + (result.result_acc_physics ?? 0),
        chemistry: acc.chemistry + (result.result_acc_chemistry ?? 0),
        law: acc.law + (result.result_acc_law ?? 0),
        engineering: acc.engineering + (result.result_acc_engineering ?? 0),
        economics: acc.economics + (result.result_acc_economics ?? 0),
        health: acc.health + (result.result_acc_health ?? 0),
        psychology: acc.psychology + (result.result_acc_psychology ?? 0),
        business: acc.business + (result.result_acc_business ?? 0),
        biology: acc.biology + (result.result_acc_biology ?? 0),
        philosophy: acc.philosophy + (result.result_acc_philosophy ?? 0),
        cs: acc.cs + (result.result_acc_cs ?? 0),
        history: acc.history + (result.result_acc_history ?? 0),
        math: acc.math + (result.result_acc_math ?? 0),
        other: acc.other + (result.result_acc_other ?? 0),
        total: acc.total + (result.result_acc_total ?? 0)
      }),
      {
        physics: 0,
        chemistry: 0,
        law: 0,
        engineering: 0,
        economics: 0,
        health: 0,
        psychology: 0,
        business: 0,
        biology: 0,
        philosophy: 0,
        cs: 0,
        history: 0,
        math: 0,
        other: 0,
        total: 0
      }
    );

    const toPercent = (value: number) => (value / count) * 100;

    return [
      { label: 'Physics', accuracy: toPercent(sums.physics), allAccuracy: null },
      { label: 'Chemistry', accuracy: toPercent(sums.chemistry), allAccuracy: null },
      { label: 'Law', accuracy: toPercent(sums.law), allAccuracy: null },
      { label: 'Engineering', accuracy: toPercent(sums.engineering), allAccuracy: null },
      { label: 'Economics', accuracy: toPercent(sums.economics), allAccuracy: null },
      { label: 'Health', accuracy: toPercent(sums.health), allAccuracy: null },
      { label: 'Psychology', accuracy: toPercent(sums.psychology), allAccuracy: null },
      { label: 'Business', accuracy: toPercent(sums.business), allAccuracy: null },
      { label: 'Biology', accuracy: toPercent(sums.biology), allAccuracy: null },
      { label: 'Philosophy', accuracy: toPercent(sums.philosophy), allAccuracy: null },
      { label: 'C-Science', accuracy: toPercent(sums.cs), allAccuracy: null },
      { label: 'History', accuracy: toPercent(sums.history), allAccuracy: null },
      { label: 'Math', accuracy: toPercent(sums.math), allAccuracy: null },
      { label: 'Other', accuracy: toPercent(sums.other), allAccuracy: null },
      { label: 'All', accuracy: null, allAccuracy: toPercent(sums.total) }
    ];
  }, [testResult]);

  if (!testResult) return null;

  return (
    <Box sx={{ p: 3, width: '100%' }}>
      <TestResultInfo
        name={testResult.name}
        description={testResult.description}
        examType={{
          label: 'Type of exam',
          value: 'MMLU-Pro'
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
          value: dayjs(testResult.started_at).tz(TIMEZONE).format('YYYY-MM-DD HH:mm')
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
      {testResultGraphs && (
        <Box>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '1rem'
            }}
          >
            <Typography
              component={'h3'}
              fontWeight={700}
              fontSize={'1.5rem'}
              sx={{ color: '#1E293B', letterSpacing: '-0.02em' }}
            >
              Accuracy Graph: {testResult.name}
            </Typography>
            <Button
              variant="contained"
              onClick={() => {
                console.log('Download button is clicked!');
                downloadExcel();
              }}
              startIcon={<DownloadOutlinedIcon />}
            >
              Download
            </Button>
          </div>
          {averageDatasets && (
            <BarGraph
              key="average"
              dataset={averageDatasets}
              xAxis={[
                {
                  dataKey: 'label'
                }
              ]}
              series={[
                {
                  dataKey: 'accuracy',
                  label: `Subjects (Average of ${testResult.results.length} repetitions)`,
                  valueFormatter: value => value != null ? `${value}%` : '',
                  color: '#4F46E5'
                },
                {
                  dataKey: 'allAccuracy',
                  label: 'Overall (All)',
                  valueFormatter: value => value != null ? `${value}%` : '',
                  color: '#10B981'
                }
              ]}
              yAxis={[
                {
                  label: 'Accuracy rate (%)',
                  width: 60
                }
              ]}
              sx={{
                '& .MuiChartsLabel-root.MuiChartsLegend-label': {
                  fontSize: '1.25rem',
                  fontWeight: 500
                },
                marginBottom: '2.5rem'
              }}
            />
          )}
          {testResultGraphs.map(item => (
            <BarGraph
              key={item.id}
              dataset={item.datasets}
              xAxis={[
                {
                  dataKey: 'label'
                }
              ]}
              series={[
                {
                  dataKey: 'accuracy',
                  label: `Subjects (Repetition ${item.resultNumber})`,
                  valueFormatter: value => value != null ? `${value}%` : '',
                  color: '#4F46E5'
                },
                {
                  dataKey: 'allAccuracy',
                  label: 'Overall (All)',
                  valueFormatter: value => value != null ? `${value}%` : '',
                  color: '#10B981'
                }
              ]}
              yAxis={[
                {
                  label: 'Accuracy rate (%)',
                  width: 60
                }
              ]}
              sx={{
                '& .MuiChartsLabel-root.MuiChartsLegend-label': {
                  fontSize: '1.25rem',
                  fontWeight: 500
                },
                marginBottom: '2.5rem'
              }}
            />
          ))}
        </Box>
      )}
    </Box>
  );
};

export default TestResultPage;
