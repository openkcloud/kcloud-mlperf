import { Fragment, useRef, useState } from 'react';
import { type SubmitHandler } from 'react-hook-form';

import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import AddIcon from '@mui/icons-material/Add';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Chip,
  FormControlLabel,
  Paper,
  Switch,
  Typography
} from '@mui/material';

// ----------------------------------------------------------------------

const HIDE_SWEEP_KEY = 'HIDE_SWEEP_RUNS';

const initHideSweep = (): boolean => {
  const stored = localStorage.getItem(HIDE_SWEEP_KEY);
  if (stored !== null) return stored === 'true';
  const defaultOn = import.meta.env.PROD;
  localStorage.setItem(HIDE_SWEEP_KEY, String(defaultOn));
  return defaultOn;
};
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

import type { MpExamCreateBody, MpExamDetails } from '@/api/types/mp-exam.types';
import { TIMEZONE } from '@/constants/timezone.constants';
import type { MpExamModeEnum } from '@/enums/mp-exam-mode.enum';
import type { TestScenarioEnum } from '@/enums/test-scenario.enum';

import { MpExamConfirmationModal } from '@/pages/mlperf/main/components/ExamConfirmationModal';
import { MpExamForm, type MpExamFormHandle } from '@/pages/mlperf/main/exam-form';
import type { MpExamFormInput } from '@/pages/mlperf/main/exam-form/form.type';
import { MlperfExamResultTable } from '@/pages/mlperf/main/exam-table';

// ----------------------------------------------------------------------

dayjs.extend(utc);
dayjs.extend(timezone);

// ----------------------------------------------------------------------

const MLPerfPage = () => {
  const [modalData, setModalData] = useState<MpExamCreateBody | null>(null);
  const [formExpanded, setFormExpanded] = useState(false);
  const [hideSweep, setHideSweep] = useState(initHideSweep);
  const formRef = useRef<MpExamFormHandle | null>(null);

  const handleHideSweepChange = (checked: boolean) => {
    setHideSweep(checked);
    localStorage.setItem(HIDE_SWEEP_KEY, String(checked));
  };

  const onSubmit: SubmitHandler<MpExamFormInput> = async data => {
    const {
      name,
      batchSize,
      cpuCore,
      dataNumber,
      dataset,
      description,
      framework,
      gpuNumber,
      gpuType,
      minDuration,
      mode,
      model,
      numOfWorkers,
      precision,
      ramSize,
      repetitionCount,
      scenario,
      targetQps,
      tensorParallelSize,
      time
    } = data;

    const generatedName = name || `${model.label}-${dataset.label}`;

    setModalData({
      name: generatedName,
      description,
      batch_size: Number(batchSize),
      cpu_core: Number(cpuCore.value),
      data_number: Number(dataNumber),
      dataset: dataset.value,
      framework: framework.value,
      gpu_num: Number(gpuNumber.value),
      gpu_type: gpuType.value,
      min_duration: Number(minDuration),
      mode: mode.value as MpExamModeEnum,
      model: model.value,
      num_workers: Number(numOfWorkers),
      precision: precision.value,
      ram_capacity: Number(ramSize),
      retry_num: Number(repetitionCount),
      scenario: scenario.value as TestScenarioEnum,
      target_qps: Number(targetQps),
      tensor_parallel_size: Number(tensorParallelSize),
      started_at: dayjs(time).tz(TIMEZONE).second(0).millisecond(0).format('YYYY-MM-DDTHH:mmZ')
    });
  };

  const handleCloseModal = () => {
    setModalData(null);
  };
  const handleUseData = (exam: MpExamDetails) => {
    setFormExpanded(true);
    setTimeout(() => {
      formRef.current?.fillBenchmarkSettings(exam);
    }, 100);
  };

  return (
    <Fragment>
      {/* Quick Stats Banner */}
      <Box
        sx={{
          background: 'linear-gradient(135deg, #EEF2FF 0%, #F0F9FF 50%, #ECFDF5 100%)',
          border: '1px solid #E0E7FF',
          borderRadius: '0.75rem',
          px: 2.5,
          py: 1.5,
          mb: 2.5,
          display: 'flex',
          gap: 1.5,
          flexWrap: 'wrap',
          alignItems: 'center'
        }}
      >
        <Chip
          label="MLPerf v5.1"
          size="small"
          sx={{
            bgcolor: '#4F46E5',
            color: '#FFF',
            fontWeight: 600,
            fontSize: '0.75rem'
          }}
        />
        <Chip
          label="Accuracy & Performance"
          size="small"
          sx={{
            bgcolor: '#10B981',
            color: '#FFF',
            fontWeight: 600,
            fontSize: '0.75rem'
          }}
        />
        <Chip
          label="Offline / Server Scenarios"
          size="small"
          sx={{
            bgcolor: '#F59E0B',
            color: '#FFF',
            fontWeight: 600,
            fontSize: '0.75rem'
          }}
        />
      </Box>

      {/* Toolbar — Hide sweep toggle */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1.5 }}>
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={hideSweep}
              onChange={e => handleHideSweepChange(e.target.checked)}
            />
          }
          label={
            <Typography sx={{ fontSize: '0.8125rem', color: '#475569' }}>
              Hide sweep runs
            </Typography>
          }
        />
      </Box>

      {/* Results Table — Primary View */}
      <MlperfExamResultTable onUseData={handleUseData} hideSweepRuns={hideSweep} />

      {/* Create Test — Collapsible */}
      <Accordion
        expanded={formExpanded}
        onChange={(_, expanded) => setFormExpanded(expanded)}
        elevation={0}
        sx={{
          mt: 2.5,
          border: '2px solid',
          borderColor: formExpanded ? '#818CF8' : '#C7D2FE',
          borderRadius: '0.75rem !important',
          '&::before': { display: 'none' },
          overflow: 'hidden',
          background: formExpanded ? '#FFFFFF' : 'linear-gradient(135deg, #FAFBFF 0%, #F0F4FF 100%)',
          transition: 'all 0.3s ease',
          '&:hover': {
            borderColor: '#818CF8',
            boxShadow: '0 0 0 3px rgba(79, 70, 229, 0.08)'
          }
        }}
      >
        <AccordionSummary
          expandIcon={<ExpandMoreIcon sx={{ color: '#4F46E5' }} />}
          sx={{
            bgcolor: 'transparent',
            minHeight: 64,
            '&.Mui-expanded': { minHeight: 64 },
            '& .MuiAccordionSummary-content': {
              alignItems: 'center',
              gap: 1.5
            }
          }}
        >
          <Box
            sx={{
              width: 40,
              height: 40,
              borderRadius: '0.625rem',
              background: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              boxShadow: '0 2px 8px rgba(79, 70, 229, 0.3)'
            }}
          >
            <AddIcon sx={{ color: '#FFF', fontSize: '1.375rem' }} />
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography sx={{ fontWeight: 700, color: '#1E293B', fontSize: '1rem', lineHeight: 1.3 }}>
              Create New Test
            </Typography>
            <Typography sx={{ fontSize: '0.8125rem', color: '#64748B', lineHeight: 1.3 }}>
              Configure and schedule a new MLPerf benchmark
            </Typography>
          </Box>
          {!formExpanded && (
            <Chip
              label="Click to expand"
              size="small"
              sx={{
                bgcolor: 'rgba(79,70,229,0.08)',
                color: '#4F46E5',
                fontWeight: 600,
                fontSize: '0.6875rem',
                border: '1px solid rgba(79,70,229,0.2)',
                mr: 1
              }}
            />
          )}
        </AccordionSummary>
        <AccordionDetails sx={{ p: 3, pt: 2, bgcolor: '#FFFFFF' }}>
          <MpExamForm ref={formRef} onSubmit={onSubmit} />
        </AccordionDetails>
      </Accordion>

      <MpExamConfirmationModal modalState={modalData} handleClose={handleCloseModal} />

      <Paper sx={{ p: 2, mt: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Typography variant="h6">Live Bench Dashboard (GPU realtime)</Typography>
          <Typography variant="caption">
            <a
              href="/dashboard/gpu-realtime"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#3aa3ff', textDecoration: 'none' }}
            >
              open in new tab ↗
            </a>
          </Typography>
        </Box>
        <Box
          component="iframe"
          src="/dashboard/gpu-realtime"
          title="GPU realtime dashboard"
          sx={{ width: '100%', height: 700, border: 0, borderRadius: 1, bgcolor: '#0e1117', display: 'block' }}
        />
      </Paper>
    </Fragment>
  );
};

export default MLPerfPage;
