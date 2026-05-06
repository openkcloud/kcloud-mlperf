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
  Switch,
  Typography
} from '@mui/material';

import {
  LiveBenchDashboard,
  getL40LiveBenchUrl,
  getA40LiveBenchUrl,
} from '@/components/benchmark-page';

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

import type { MmExamCreateBody, MmExamResultList } from '@/api/types/mm-exam.types';
import { TIMEZONE } from '@/constants/timezone.constants';

import { MmluExamConfirmationModal } from '@/pages/mmlu/main/components/ExamConfirmationModal';
import { MmluExamForm, type MmluExamFormHandle } from '@/pages/mmlu/main/exam-form';
import type { MlExamFormInput } from '@/pages/mmlu/main/exam-form/form.type';
import { MmluExamResultTable } from '@/pages/mmlu/main/exam-table';

// ----------------------------------------------------------------------

dayjs.extend(utc);
dayjs.extend(timezone);

// ----------------------------------------------------------------------

const MMLUPage = () => {
  const [modalData, setModalData] = useState<MmExamCreateBody | null>(null);
  const [formExpanded, setFormExpanded] = useState(false);
  const [hideSweep, setHideSweep] = useState(initHideSweep);
  const formRef = useRef<MmluExamFormHandle | null>(null);

  const handleHideSweepChange = (checked: boolean) => {
    setHideSweep(checked);
    localStorage.setItem(HIDE_SWEEP_KEY, String(checked));
  };

  const onSubmit: SubmitHandler<MlExamFormInput> = async data => {
    const {
      name,
      batchSize,
      cpuCore,
      ramSize,
      repetitionCount,
      dataset,
      description,
      framework,
      gpuNumber,
      gpuType,
      gpuUtil,
      maxTokens,
      dataNumber,
      precision,
      time,
      model,
      subjects
    } = data;

    const generatedName = name || `${model.label}-${dataset.label}`;

    setModalData({
      name: generatedName,
      description,
      batch_size: Number(batchSize),
      cpu_core: Number(cpuCore.value),
      data_number: Number(dataNumber),
      dataset: dataset.value as string,
      framework: framework.value as string,
      gpu_num: Number(gpuNumber.value),
      gpu_type: gpuType.value as string,
      model: model.value as string,
      max_tokens: Number(maxTokens),
      retry_num: Number(repetitionCount),
      precision: precision.value as string,
      ram_capacity: Number(ramSize),
      started_at: dayjs(time).tz(TIMEZONE).second(0).millisecond(0).format('YYYY-MM-DDTHH:mmZ'),
      subject: subjects,
      gpu_util: Number(gpuUtil)
    });
  };

  const handleCloseModal = () => {
    setModalData(null);
  };

  const handleUseData = (exam: MmExamResultList) => {
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
          background: 'linear-gradient(135deg, #F0F9FF 0%, #EDE9FE 50%, #FDF4FF 100%)',
          border: '1px solid #BAE6FD',
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
          label="MMLU-Pro"
          size="small"
          sx={{
            bgcolor: '#0EA5E9',
            color: '#FFF',
            fontWeight: 600,
            fontSize: '0.75rem'
          }}
        />
        <Chip
          label="Multi-Subject Accuracy"
          size="small"
          sx={{
            bgcolor: '#10B981',
            color: '#FFF',
            fontWeight: 600,
            fontSize: '0.75rem'
          }}
        />
        <Chip
          label="14 Subject Categories"
          size="small"
          sx={{
            bgcolor: '#A855F7',
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
      <MmluExamResultTable onUseData={handleUseData} hideSweepRuns={hideSweep} />

      {/* Create Test — Collapsible */}
      <Accordion
        expanded={formExpanded}
        onChange={(_, expanded) => setFormExpanded(expanded)}
        elevation={0}
        sx={{
          mt: 2.5,
          border: '2px solid',
          borderColor: formExpanded ? '#38BDF8' : '#BAE6FD',
          borderRadius: '0.75rem !important',
          '&::before': { display: 'none' },
          overflow: 'hidden',
          background: formExpanded ? '#FFFFFF' : 'linear-gradient(135deg, #F8FCFF 0%, #F0F9FF 100%)',
          transition: 'all 0.3s ease',
          '&:hover': {
            borderColor: '#38BDF8',
            boxShadow: '0 0 0 3px rgba(14, 165, 233, 0.08)'
          }
        }}
      >
        <AccordionSummary
          expandIcon={<ExpandMoreIcon sx={{ color: '#0EA5E9' }} />}
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
              background: 'linear-gradient(135deg, #0EA5E9 0%, #6366F1 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              boxShadow: '0 2px 8px rgba(14, 165, 233, 0.3)'
            }}
          >
            <AddIcon sx={{ color: '#FFF', fontSize: '1.375rem' }} />
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography sx={{ fontWeight: 700, color: '#1E293B', fontSize: '1rem', lineHeight: 1.3 }}>
              Create New Test
            </Typography>
            <Typography sx={{ fontSize: '0.8125rem', color: '#64748B', lineHeight: 1.3 }}>
              Configure and schedule a new MMLU-Pro benchmark
            </Typography>
          </Box>
          {!formExpanded && (
            <Chip
              label="Click to expand"
              size="small"
              sx={{
                bgcolor: 'rgba(14,165,233,0.08)',
                color: '#0284C7',
                fontWeight: 600,
                fontSize: '0.6875rem',
                border: '1px solid rgba(14,165,233,0.2)',
                mr: 1
              }}
            />
          )}
        </AccordionSummary>
        <AccordionDetails sx={{ p: 3, pt: 2, bgcolor: '#FFFFFF' }}>
          <MmluExamForm ref={formRef} onSubmit={onSubmit} />
        </AccordionDetails>
      </Accordion>

      <MmluExamConfirmationModal modalState={modalData} handleClose={handleCloseModal} />

      <LiveBenchDashboard
        title="Live GPU Dashboard (MMLU-Pro — L40)"
        src={getL40LiveBenchUrl()}
        height={900}
      />

      <LiveBenchDashboard
        title="Live GPU Dashboard (MMLU-Pro — A40)"
        src={getA40LiveBenchUrl()}
        height={900}
      />
    </Fragment>
  );
};

export default MMLUPage;
