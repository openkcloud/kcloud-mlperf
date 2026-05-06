import { forwardRef, memo, useEffect, useImperativeHandle, useMemo } from 'react';
import { Controller, type SubmitHandler, useForm } from 'react-hook-form';

import { useMpGpuList } from './useGpuList';
import { Box, Button, Grid, Paper, Typography } from '@mui/material';
import dayjs from 'dayjs';

import type { MpExamDetails } from '@/api/types/mp-exam.types';
import { DatePicker } from '@/components/DatePicker';
import { TextArea } from '@/components/Inputs/TextArea';
import { TextInput } from '@/components/Inputs/TextInput';
import { SelectMenu } from '@/components/SelectMenu';

import { MLPERF_DATASET_MAP } from '@/constants/dataset-mapping.constants';
import { useDatasetsList } from '@/hooks/useDatasetsList';
import { useModelsList } from '@/hooks/useModelsList';
import { useSettingsList } from '@/hooks/useSettingsList';

import { useGpuModel } from '@/hooks/useGpuModel.ts';

import {
  cpuCoreList,
  frameworkList,
  modeList,
  precisionList,
  scenarioList
} from '@/pages/mlperf/main/exam-form/fake-data';
import type { MpExamFormInput } from '@/pages/mlperf/main/exam-form/form.type';

// ----------------------------------------------------------------------

const SectionHeader = ({ color, label }: { color: string; label: string }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2.5 }}>
    <Box
      sx={{
        width: 4,
        height: 20,
        borderRadius: 1,
        bgcolor: color,
        flexShrink: 0
      }}
    />
    <Typography
      sx={{
        fontWeight: 700,
        color: '#1E293B',
        fontSize: '0.875rem',
        letterSpacing: '0.02em'
      }}
    >
      {label}
    </Typography>
  </Box>
);

// Responsive grid sizes: 12 on xs, 6 on sm, 4 on lg (3 columns)
const fieldGrid = { xs: 12, sm: 6, lg: 4 };

// ----------------------------------------------------------------------

const FP8_MODEL = { label: 'Llama-3.1-8B-Instruct (FP8)', value: 'Llama-3.1-8B-Instruct-FP8' };

const initialData: MpExamFormInput = {
  name: '',
  description: '',
  model: {
    label: '',
    value: ''
  },
  mode: { value: 'accuracy', label: 'Accuracy' },
  dataset: {
    label: '',
    value: ''
  },
  precision: { value: 'bfloat16', label: 'bfloat16' },
  scenario: { value: 'offline', label: 'Offline' },
  framework: { value: 'vllm', label: 'vllm' },
  gpuType: {
    label: '',
    value: ''
  },
  gpuNumber: {
    label: '',
    value: ''
  },
  cpuCore: { value: 8, label: '8 Cores' },
  dataNumber: 0,
  targetQps: 0.5,
  batchSize: 1,
  numOfWorkers: 1,
  minDuration: 0,
  tensorParallelSize: 1,
  maxOutputTokens: 128,
  ramSize: 16,
  repetitionCount: 1,
  time: dayjs()
};

// ----------------------------------------------------------------------

type MlPerfFormProps = {
  onSubmit: SubmitHandler<MpExamFormInput>;
  size?: 'small' | 'medium';
};

export type MpExamFormHandle = {
  fillBenchmarkSettings: (exam: MpExamDetails) => void;
};

// ----------------------------------------------------------------------

export const MpExamForm = memo(
  forwardRef<MpExamFormHandle, MlPerfFormProps>((props, ref) => {
    const { onSubmit, size = 'medium' } = props;

    const { gpuList, refetchGpuList } = useMpGpuList();
    const { models: apiModels } = useModelsList();
    const { datasets: apiDatasets, refetchDatasets } = useDatasetsList();
    const { settings, refetchSettings } = useSettingsList();

    const { control, handleSubmit, watch, setValue } = useForm<MpExamFormInput>({
      defaultValues: initialData
    });

    const selectedGpuType = watch('gpuType');
    const selectedScenario = watch('scenario');
    const selectedModel = watch('model');

    // Extract models from settings.mlperf; always include FP8 variant
    const models = useMemo(() => {
      const base: { label: string; value: string }[] = settings?.mlperf
        ? Object.keys(settings.mlperf).map(name => ({ label: name, value: name }))
        : apiModels;
      const hasFp8 = base.some(m => m.value === FP8_MODEL.value);
      return hasFp8 ? base : [...base, FP8_MODEL];
    }, [settings?.mlperf, apiModels]);

    // Extract datasets: local mapping → settings API → all datasets fallback
    const datasets = useMemo(() => {
      if (selectedModel?.value) {
        // 1. Check local model-dataset mapping (known correct mappings)
        const localDatasets = MLPERF_DATASET_MAP[selectedModel.value];
        if (localDatasets && localDatasets.length > 0) {
          return localDatasets.map(name => ({ label: name, value: name }));
        }
        // 2. Check settings API mapping
        if (settings?.mlperf) {
          const settingsDatasets = settings.mlperf[selectedModel.value];
          if (settingsDatasets && Array.isArray(settingsDatasets)) {
            return settingsDatasets.map(name => ({ label: name, value: name }));
          }
        }
      }
      // 3. Fallback: show all datasets from the API
      return apiDatasets;
    }, [selectedModel?.value, settings?.mlperf, apiDatasets]);

    const { gpuTypes, gpuNumbers } = useGpuModel({ gpuList, selectedGpuType });

    useImperativeHandle(ref, () => ({
      fillBenchmarkSettings: (exam: MpExamDetails) => {
        // Fill benchmark settings fields using exact exam data
        setValue('model', { label: exam.model, value: exam.model });
        setValue('dataset', { label: exam.dataset, value: exam.dataset });
        setValue('precision', { label: exam.precision, value: exam.precision });
        setValue('dataNumber', exam.data_number);
        setValue('mode', { label: exam.mode, value: exam.mode });
        setValue('scenario', { label: exam.scenario, value: exam.scenario });
        setValue('framework', { label: exam.framework, value: exam.framework });
        setValue('targetQps', exam.target_qps);
        setValue('batchSize', exam.batch_size);
        setValue('numOfWorkers', exam.num_workers);
        setValue('minDuration', exam.min_duration);
        setValue('tensorParallelSize', exam.tensor_parallel_size);
      }
    }));

    useEffect(() => {
      setValue('minDuration', selectedScenario.value === 'offline' ? 600_000 : 120_000);
    }, [selectedScenario, setValue]);

    // Clear dataset when model changes
    useEffect(() => {
      if (selectedModel?.value) {
        setValue('dataset', { label: '', value: '' });
      }
    }, [selectedModel?.value, setValue]);

    return (
      <form onSubmit={handleSubmit(onSubmit)}>
        {/* Basic Info */}
        <Grid container spacing={2.5} sx={{ mb: 3 }}>
          <Grid size={{ xs: 12, sm: 8 }}>
            <Controller
              name="name"
              control={control}
              render={({ field, fieldState }) => {
                const { error } = fieldState;
                return (
                  <TextInput
                    {...field}
                    size={size}
                    label="Test Name (Optional)"
                    hasError={Boolean(error)}
                    helperText={error?.message}
                    inputLabel="Enter test name"
                  />
                );
              }}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 8 }}>
            <Controller
              name="description"
              control={control}
              render={({ field }) => {
                return (
                  <TextArea
                    {...field}
                    label="Test Description"
                    placeholder="Enter test description"
                    required={false}
                  />
                );
              }}
            />
          </Grid>
        </Grid>

        {/* Benchmark Settings Section */}
        <Paper
          variant="outlined"
          sx={{
            p: 2.5,
            mb: 2.5,
            borderColor: '#E2E8F0',
            borderRadius: '0.75rem',
            backgroundColor: '#FAFBFC'
          }}
        >
          <SectionHeader color="#4F46E5" label="Benchmark Settings" />
          <Grid container spacing={2.5}>
            <Grid size={fieldGrid}>
              <Controller
                name="model"
                control={control}
                render={({ field, fieldState }) => {
                  const { name, value, onChange } = field;
                  const { error } = fieldState;
                  return (
                    <SelectMenu
                      name={name}
                      value={value}
                      onChange={onChange}
                      options={models}
                      hasError={Boolean(error)}
                      helperText={error?.message}
                      inputLabel="Select a model"
                      label="Model (/mnt/models)"
                      refreshBtn={{ onClick: () => refetchSettings() }}
                      required
                    />
                  );
                }}
                rules={{ required: 'Please select a model' }}
              />
            </Grid>
            <Grid size={fieldGrid}>
              <Controller
                name="dataset"
                control={control}
                render={({ field, fieldState }) => {
                  const { name, value, onChange } = field;
                  const { error } = fieldState;
                  return (
                    <SelectMenu
                      name={name}
                      value={value}
                      onChange={onChange}
                      options={datasets}
                      hasError={Boolean(error)}
                      helperText={error?.message}
                      label="Dataset (/mnt/datasets)"
                      inputLabel="Select a dataset"
                      refreshBtn={{ onClick: () => Promise.all([refetchSettings(), refetchDatasets()]) }}
                      required
                    />
                  );
                }}
                rules={{ required: 'Please select a datasets' }}
              />
            </Grid>
            <Grid size={fieldGrid}>
              <Controller
                name="precision"
                control={control}
                render={({ field, fieldState }) => {
                  const { name, value, onChange } = field;
                  const { error } = fieldState;
                  return (
                    <SelectMenu
                      name={name}
                      value={value}
                      onChange={onChange}
                      options={precisionList}
                      hasError={Boolean(error)}
                      helperText={error?.message}
                      label="Precision"
                      inputLabel="Select a precision"
                      required
                    />
                  );
                }}
                rules={{ required: 'Please select a precision' }}
              />
            </Grid>
            <Grid size={fieldGrid}>
              <Controller
                name="mode"
                control={control}
                render={({ field, fieldState }) => {
                  const { name, value, onChange } = field;
                  const { error } = fieldState;
                  return (
                    <SelectMenu
                      name={name}
                      value={value}
                      onChange={onChange}
                      options={modeList}
                      hasError={Boolean(error)}
                      helperText={error?.message}
                      label="Mode"
                      inputLabel="Select a mode"
                      required
                    />
                  );
                }}
                rules={{ required: 'Please select a mode' }}
              />
            </Grid>
            <Grid size={fieldGrid}>
              <Controller
                name="scenario"
                control={control}
                render={({ field, fieldState }) => {
                  const { name, value, onChange } = field;
                  const { error } = fieldState;
                  return (
                    <SelectMenu
                      name={name}
                      value={value}
                      onChange={onChange}
                      options={scenarioList}
                      hasError={Boolean(error)}
                      helperText={error?.message}
                      label="Scenario"
                      inputLabel="Select a scenario"
                      required
                    />
                  );
                }}
                rules={{ required: 'Please select a scenario' }}
              />
            </Grid>
            <Grid size={fieldGrid}>
              <Controller
                name="framework"
                control={control}
                render={({ field, fieldState }) => {
                  const { name, value, onChange } = field;
                  const { error } = fieldState;
                  return (
                    <SelectMenu
                      name={name}
                      value={value}
                      onChange={onChange}
                      options={frameworkList}
                      hasError={Boolean(error)}
                      helperText={error?.message}
                      label="Framework"
                      inputLabel="Select a framework"
                      required
                    />
                  );
                }}
                rules={{ required: 'Please select a framework' }}
              />
            </Grid>
            <Grid size={fieldGrid}>
              <Controller
                name="dataNumber"
                control={control}
                render={({ field, fieldState }) => {
                  const { error } = fieldState;
                  return (
                    <TextInput
                      {...field}
                      size={size}
                      type="number"
                      hasError={Boolean(error)}
                      helperText={error?.message}
                      label="Number of data (0 = full)"
                    />
                  );
                }}
                rules={{ min: { value: 0, message: 'Number of data should be positive!' } }}
              />
            </Grid>
            <Grid size={fieldGrid}>
              <Controller
                name="targetQps"
                control={control}
                render={({ field, fieldState }) => {
                  const { error } = fieldState;
                  return (
                    <TextInput
                      {...field}
                      size={size}
                      type="number"
                      label="Target QPS (Server)"
                      hasError={Boolean(error)}
                      helperText={error?.message}
                    />
                  );
                }}
                rules={{ min: { value: 0, message: 'Target QPS should be positive!' } }}
              />
            </Grid>
            <Grid size={fieldGrid}>
              <Controller
                name="batchSize"
                control={control}
                render={({ field, fieldState }) => {
                  const { error } = fieldState;
                  return (
                    <TextInput
                      {...field}
                      size={size}
                      label="Batch Size"
                      type="number"
                      hasError={Boolean(error)}
                      helperText={error?.message}
                    />
                  );
                }}
                rules={{ min: { value: 0, message: 'Batch size should be positive!' } }}
              />
            </Grid>
            <Grid size={fieldGrid}>
              <Controller
                name="numOfWorkers"
                control={control}
                render={({ field, fieldState }) => {
                  const { error } = fieldState;
                  return (
                    <TextInput
                      {...field}
                      size={size}
                      label="Workers"
                      type="number"
                      hasError={Boolean(error)}
                      helperText={error?.message}
                    />
                  );
                }}
                rules={{ min: { value: 0, message: 'Number of workers should be positive!' } }}
              />
            </Grid>
            <Grid size={fieldGrid}>
              <Controller
                name="minDuration"
                control={control}
                render={({ field, fieldState }) => {
                  const { error } = fieldState;
                  return (
                    <TextInput
                      {...field}
                      size={size}
                      label="Min Duration"
                      type="number"
                      hasError={Boolean(error)}
                      helperText={error?.message}
                    />
                  );
                }}
                rules={{ min: { value: 0, message: 'Min Duration should be positive!' } }}
              />
            </Grid>
            <Grid size={fieldGrid}>
              <Controller
                name="tensorParallelSize"
                control={control}
                render={({ field, fieldState }) => {
                  const { error } = fieldState;
                  return (
                    <TextInput
                      {...field}
                      size={size}
                      label="Tensor Parallel Size"
                      type="number"
                      hasError={Boolean(error)}
                      helperText={error?.message}
                    />
                  );
                }}
                rules={{ min: { value: 0, message: 'Tensor parallel size should be positive!' } }}
              />
            </Grid>
            <Grid size={fieldGrid}>
              <Controller
                name="maxOutputTokens"
                control={control}
                render={({ field, fieldState }) => {
                  const { error } = fieldState;
                  return (
                    <TextInput
                      {...field}
                      size={size}
                      label="Max Output Tokens"
                      type="number"
                      hasError={Boolean(error)}
                      helperText={error?.message}
                    />
                  );
                }}
                rules={{
                  min: { value: 16, message: 'Min 16 tokens' },
                  max: { value: 2048, message: 'Max 2048 tokens' }
                }}
              />
            </Grid>
          </Grid>
        </Paper>

        {/* Test Configuration Section */}
        <Paper
          variant="outlined"
          sx={{
            p: 2.5,
            mb: 2.5,
            borderColor: '#E2E8F0',
            borderRadius: '0.75rem',
            backgroundColor: '#FAFBFC'
          }}
        >
          <SectionHeader color="#10B981" label="Test Configuration" />
          <Grid container spacing={2.5}>
            <Grid size={fieldGrid}>
              <Controller
                name="gpuType"
                control={control}
                render={({ field, fieldState }) => {
                  const { name, value, onChange } = field;
                  const { error } = fieldState;
                  return (
                    <SelectMenu
                      name={name}
                      value={value}
                      onChange={onChange}
                      options={gpuTypes}
                      hasError={Boolean(error)}
                      helperText={error?.message}
                      label="GPU Type"
                      inputLabel="Select a type"
                      refreshBtn={{ onClick: () => refetchGpuList() }}
                      required
                    />
                  );
                }}
                rules={{ required: 'Please select a type' }}
              />
            </Grid>
            <Grid size={fieldGrid}>
              <Controller
                name="gpuNumber"
                control={control}
                render={({ field, fieldState }) => {
                  const { name, value, onChange } = field;
                  const { error } = fieldState;
                  return (
                    <SelectMenu
                      name={name}
                      value={value}
                      onChange={onChange}
                      options={gpuNumbers}
                      hasError={Boolean(error)}
                      helperText={error?.message}
                      label="GPU Number"
                      inputLabel="Select a number"
                      required
                    />
                  );
                }}
                rules={{ required: 'Please select a number' }}
              />
            </Grid>
            <Grid size={fieldGrid}>
              <Controller
                name="cpuCore"
                control={control}
                render={({ field, fieldState }) => {
                  const { name, value, onChange } = field;
                  const { error } = fieldState;
                  return (
                    <SelectMenu
                      name={name}
                      value={value}
                      onChange={onChange}
                      options={cpuCoreList}
                      hasError={Boolean(error)}
                      helperText={error?.message}
                      label="CPU Core"
                      inputLabel="Select a core"
                      required
                    />
                  );
                }}
                rules={{ required: 'Please select a core' }}
              />
            </Grid>
            <Grid size={fieldGrid}>
              <Controller
                name="ramSize"
                control={control}
                render={({ field, fieldState }) => {
                  const { error } = fieldState;
                  return (
                    <TextInput
                      {...field}
                      size={size}
                      label="RAM (GB)"
                      type="number"
                      hasError={Boolean(error)}
                      helperText={error?.message}
                    />
                  );
                }}
                rules={{ min: { value: 0, message: 'RAM should be positive!' } }}
              />
            </Grid>
          </Grid>
        </Paper>

        {/* Scenario Settings Section */}
        <Paper
          variant="outlined"
          sx={{
            p: 2.5,
            mb: 3,
            borderColor: '#E2E8F0',
            borderRadius: '0.75rem',
            backgroundColor: '#FAFBFC'
          }}
        >
          <SectionHeader color="#F59E0B" label="Scenario Settings" />
          <Grid container spacing={2.5}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Controller
                name="repetitionCount"
                control={control}
                render={({ field, fieldState }) => {
                  const { error } = fieldState;
                  return (
                    <TextInput
                      {...field}
                      size={size}
                      label="Number of Repetitions"
                      type="number"
                      inputLabel="Enter repetition count"
                      hasError={Boolean(error)}
                      helperText={error?.message}
                    />
                  );
                }}
                rules={{ min: { value: 0, message: 'Number of repetitions should be positive!' } }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Controller
                name="time"
                control={control}
                render={({ field, fieldState }) => {
                  const { name, value, onChange } = field;
                  const { error } = fieldState;
                  return (
                    <DatePicker
                      label="Start Time"
                      name={name}
                      value={value}
                      onChange={onChange}
                      inputLabel="Event date & time"
                      sx={{ width: '100%' }}
                      hasError={Boolean(error)}
                      helperText={error?.message}
                    />
                  );
                }}
              />
            </Grid>
          </Grid>
        </Paper>

        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end'
          }}
        >
          <Button
            type="submit"
            variant="contained"
            size="large"
            sx={{
              px: 5,
              py: 1.25,
              fontSize: '0.9375rem',
              fontWeight: 700,
              background: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)',
              boxShadow: '0 4px 14px 0 rgba(79, 70, 229, 0.35)',
              '&:hover': {
                background: 'linear-gradient(135deg, #4338CA 0%, #6D28D9 100%)',
                boxShadow: '0 6px 20px 0 rgba(79, 70, 229, 0.45)',
                transform: 'translateY(-1px)'
              },
              '&:active': {
                transform: 'translateY(0)'
              },
              transition: 'all 0.2s ease'
            }}
          >
            Create Test
          </Button>
        </Box>
      </form>
    );
  })
);
