import { forwardRef, memo, useEffect, useImperativeHandle, useMemo } from 'react';
import { Controller, type SubmitHandler, useForm } from 'react-hook-form';

import { Box, Button, Chip, Grid, Paper, Typography } from '@mui/material';
import dayjs from 'dayjs';
import { isEmpty } from 'lodash';

import type { MmExamResultList } from '@/api/types/mm-exam.types';
import { DatePicker } from '@/components/DatePicker';
import { TextArea } from '@/components/Inputs/TextArea';
import { TextInput } from '@/components/Inputs/TextInput';
import { SelectMenu } from '@/components/SelectMenu';
import { useStore } from '@/store';

import { MMLU_DATASET_MAP } from '@/constants/dataset-mapping.constants';
import { useDatasetsList } from '@/hooks/useDatasetsList';
import { useModelsList } from '@/hooks/useModelsList';
import { useSettingsList } from '@/hooks/useSettingsList';
import { useGpuList } from '@/pages/mmlu/main/exam-form/useGpuList';

import { useGpuModel } from '@/hooks/useGpuModel.ts';

import { cpuCoreList } from '@/pages/mlperf/main/exam-form/fake-data.ts';
import { mlExamFrameworkList } from '@/pages/mmlu/main/exam-form/fake-data';
import type { MlExamFormInput } from '@/pages/mmlu/main/exam-form/form.type';
import {
  precisionInfoFor,
  precisionOptionsFor
} from '@/shared/precision-rules';

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

const fieldGrid = { xs: 12, sm: 6, lg: 4 };

// ----------------------------------------------------------------------

const selectValue = { label: '', value: '' };

const FP8_MODEL = { label: 'Llama-3.1-8B-Instruct (FP8)', value: 'Llama-3.1-8B-Instruct-FP8' };

const initialData: MlExamFormInput = {
  name: '',
  description: '',
  dataset: selectValue,
  model: selectValue,
  precision: { value: 'bfloat16', label: 'bfloat16' },
  framework: { value: 'vllm', label: 'vllm' },
  cpuCore: { value: 8, label: '8 Cores' },
  gpuType: selectValue,
  gpuNumber: selectValue,
  dataNumber: 0,
  batchSize: 1,
  gpuUtil: 0.8,
  maxTokens: 128,
  subjects: 'computer_science',
  ramSize: 16,
  repetitionCount: 1,
  time: dayjs()
};

// ----------------------------------------------------------------------

type MMLUFormProps = {
  size?: 'small' | 'medium';
  onSubmit: SubmitHandler<MlExamFormInput>;
};

export type MmluExamFormHandle = {
  fillBenchmarkSettings: (exam: MmExamResultList) => void;
};

// ----------------------------------------------------------------------

export const MmluExamForm = memo(
  forwardRef<MmluExamFormHandle, MMLUFormProps>((props, ref) => {
    const { size = 'medium', onSubmit } = props;

    const { setNotification } = useStore(store => store.notification);

    const { gpuList, refetchGpuList } = useGpuList();
    const { models: apiModels } = useModelsList();
    const { datasets: apiDatasets, refetchDatasets } = useDatasetsList();
    const { settings, refetchSettings } = useSettingsList();

    const { control, handleSubmit, watch, formState, setValue } = useForm<MlExamFormInput>({
      defaultValues: initialData
    });

    const { errors } = formState;

    const selectedGpuType = watch('gpuType');
    const selectedModel = watch('model');
    const selectedPrecision = watch('precision');

    // F1: device-aware precision options. See web/src/shared/precision-rules.ts.
    const mlExamPrecisionList = useMemo(
      () => precisionOptionsFor(selectedGpuType?.value as string | undefined),
      [selectedGpuType?.value]
    );
    const precisionInfo = useMemo(
      () => precisionInfoFor(selectedGpuType?.value as string | undefined),
      [selectedGpuType?.value]
    );
    const selectedPrecisionInfo = useMemo(() => {
      const match = mlExamPrecisionList.find(p => p.value === selectedPrecision?.value);
      return match?.info ?? null;
    }, [mlExamPrecisionList, selectedPrecision?.value]);

    // Extract models from settings.mmlu; always include FP8 variant
    const models = useMemo(() => {
      const base: { label: string; value: string | number }[] = settings?.mmlu
        ? Object.keys(settings.mmlu).map(name => ({ label: name, value: name }))
        : apiModels;
      const hasFp8 = base.some(m => m.value === FP8_MODEL.value);
      return hasFp8 ? base : [...base, FP8_MODEL];
    }, [settings?.mmlu, apiModels]);

    // Extract datasets: local mapping → settings API → all datasets fallback
    const datasets = useMemo(() => {
      if (selectedModel?.value) {
        // 1. Check local model-dataset mapping (known correct mappings)
        const localDatasets = MMLU_DATASET_MAP[selectedModel.value];
        if (localDatasets && localDatasets.length > 0) {
          return localDatasets.map(name => ({ label: name, value: name }));
        }
        // 2. Check settings API mapping
        if (settings?.mmlu) {
          const settingsDatasets = settings.mmlu[selectedModel.value];
          if (settingsDatasets && Array.isArray(settingsDatasets)) {
            return settingsDatasets.map(name => ({ label: name, value: name }));
          }
        }
      }
      // 3. Fallback: show all datasets from the API
      return apiDatasets;
    }, [selectedModel?.value, settings?.mmlu, apiDatasets]);

    const { gpuTypes, gpuNumbers } = useGpuModel({
      gpuList,
      selectedGpuType
    });

    useImperativeHandle(ref, () => ({
      fillBenchmarkSettings: (exam: MmExamResultList) => {
        setValue('model', { label: exam.model, value: exam.model });
        setValue('dataset', { label: exam.dataset, value: exam.dataset });
        setValue('precision', { label: exam.precision, value: exam.precision });
        setValue('dataNumber', exam.data_number);
        setValue('framework', { label: exam.framework, value: exam.framework });
        setValue('batchSize', exam.batch_size);
        setValue('subjects', exam.subject);
        setValue('gpuUtil', exam.gpu_util);
      }
    }));

    useEffect(() => {
      if (!isEmpty(errors)) {
        const { name } = errors;
        if (name?.message) {
          setNotification({ type: 'error', message: name.message });
        }
      }
    }, [errors, setNotification]);

    // Clear dataset when model changes
    useEffect(() => {
      if (selectedModel?.value) {
        setValue('dataset', { label: '', value: '' });
      }
    }, [selectedModel?.value, setValue]);

    // F1: snap precision to the first allowed value if the current one is no
    // longer valid for the selected device.
    useEffect(() => {
      if (!mlExamPrecisionList.length) return;
      const stillValid = mlExamPrecisionList.some(p => p.value === selectedPrecision?.value);
      if (!stillValid) {
        const first = mlExamPrecisionList[0];
        setValue('precision', { value: first.value, label: first.label });
      }
    }, [mlExamPrecisionList, selectedPrecision?.value, setValue]);

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
                      options={mlExamPrecisionList}
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
              {(precisionInfo || selectedPrecisionInfo) && (
                <Box sx={{ mt: 0.75, display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                  {selectedPrecisionInfo && (
                    <Chip
                      size="small"
                      label={selectedPrecisionInfo}
                      sx={{
                        fontSize: '0.6875rem',
                        height: 22,
                        bgcolor: '#EEF2FF',
                        color: '#3730A3',
                        border: '1px solid #C7D2FE'
                      }}
                    />
                  )}
                  {precisionInfo && (
                    <Chip
                      size="small"
                      label={precisionInfo}
                      sx={{
                        fontSize: '0.6875rem',
                        height: 22,
                        bgcolor: '#FEF3C7',
                        color: '#92400E',
                        border: '1px solid #FDE68A'
                      }}
                    />
                  )}
                </Box>
              )}
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
                      options={mlExamFrameworkList}
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
                    <Box>
                      <TextInput
                        {...field}
                        size={size}
                        type="number"
                        hasError={Boolean(error)}
                        helperText={error?.message}
                        label="Number of Data (0 = full)"
                      />
                      {/* B-validation #21: 0 is a valid "full dataset" sentinel —
                          make that explicit so accidental empty/0 entries are clear. */}
                      <Typography
                        sx={{ mt: 0.5, fontSize: '0.6875rem', color: '#64748B' }}
                      >
                        0 = full dataset
                      </Typography>
                    </Box>
                  );
                }}
                rules={{ min: { value: 0, message: 'Number of data should be positive!' } }}
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
                name="subjects"
                control={control}
                render={({ field, fieldState }) => {
                  const { error } = fieldState;
                  return (
                    <TextInput
                      {...field}
                      size={size}
                      label="Subjects"
                      hasError={Boolean(error)}
                      helperText={
                        error?.message ??
                        "Use 'all' for full eval (samples × 14 subjects = long), or a single subject like 'computer_science' for a quick demo run."
                      }
                    />
                  );
                }}
              />
            </Grid>
            <Grid size={fieldGrid}>
              <Controller
                name="gpuUtil"
                control={control}
                render={({ field, fieldState }) => {
                  const { error } = fieldState;
                  return (
                    <TextInput
                      {...field}
                      size={size}
                      label="GPU Utilization"
                      type="number"
                      hasError={Boolean(error)}
                      helperText={error?.message}
                    />
                  );
                }}
                rules={{ min: { value: 0, message: 'GPU util should be positive!' } }}
              />
            </Grid>
            <Grid size={fieldGrid}>
              <Controller
                name="maxTokens"
                control={control}
                render={({ field, fieldState }) => {
                  const { error } = fieldState;
                  return (
                    <TextInput
                      {...field}
                      size={size}
                      label="Max Tokens"
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
                rules={{ min: { value: 1, message: 'At least 1 repetition required' } }}
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
              background: 'linear-gradient(135deg, #0EA5E9 0%, #6366F1 100%)',
              boxShadow: '0 4px 14px 0 rgba(14, 165, 233, 0.35)',
              '&:hover': {
                background: 'linear-gradient(135deg, #0284C7 0%, #4F46E5 100%)',
                boxShadow: '0 6px 20px 0 rgba(14, 165, 233, 0.45)',
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
