import { memo } from 'react';

import { Box, Chip, Grid, Typography } from '@mui/material';

import { TestInfoItem as InfoItem } from '@/components/TestInfoItem/TestInfoItem';

type ValueType = { label: string; value: string | number };

type TestResultInfoProps = {
  order?: 1 | 2;
  name: string;
  description: string;
  examType: ValueType;
  model: ValueType;
  gpu: ValueType;
  numberOfRepetition: number;
  dataset: ValueType;
  precision: ValueType;
  cpu: ValueType;
  startTime: ValueType;
  dataNumber: ValueType;
  framework: ValueType;
  ram: ValueType;
  endTime: ValueType;
};

export const TestResultInfo = memo<TestResultInfoProps>(props => {
  const {
    order,
    name,
    description,
    examType,
    model,
    gpu,
    numberOfRepetition,
    dataset,
    precision,
    cpu,
    startTime,
    dataNumber,
    framework,
    ram,
    endTime
  } = props;

  return (
    <Box
      sx={{
        marginBottom: '4rem',
        border: '1px solid',
        borderColor: 'grey.200',
        borderRadius: '1rem',
        overflow: 'hidden',
        boxShadow: '0 1px 3px 0 rgba(0,0,0,0.06), 0 1px 2px -1px rgba(0,0,0,0.04)'
      }}
    >
      {/* Card header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          padding: '1.25rem 1.5rem',
          borderBottom: '1px solid',
          borderColor: 'grey.200',
          background: 'linear-gradient(135deg, #EEF2FF 0%, #E0F2FE 100%)'
        }}
      >
        {order && (
          <Chip
            label={`Test ${order}`}
            size="small"
            sx={{
              backgroundColor: '#4F46E5',
              color: 'white',
              fontWeight: 600,
              fontSize: '0.75rem',
              height: '1.5rem'
            }}
          />
        )}
        <Typography component="h2" fontSize="1.125rem" fontWeight={600} color="#1E1B4B">
          {name}
        </Typography>
      </Box>

      <Box sx={{ padding: '1.5rem' }}>
        {/* Description section */}
        <Box
          sx={{
            marginBottom: '1.5rem',
            padding: '1rem',
            backgroundColor: '#F8FAFF',
            borderRadius: '0.5rem',
            border: '1px solid #E0E7FF'
          }}
        >
          <Typography
            component="p"
            sx={{
              fontSize: '0.6875rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: '#4F46E5',
              marginBottom: '0.375rem'
            }}
          >
            Description
          </Typography>
          <Typography component="p" fontSize="0.9375rem" color="grey.800" lineHeight={1.6}>
            {description}
          </Typography>
        </Box>

        {/* Section label */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            marginBottom: '1rem'
          }}
        >
          <Box
            sx={{
              width: '3px',
              height: '1rem',
              borderRadius: '2px',
              backgroundColor: '#0EA5E9'
            }}
          />
          <Typography
            component="p"
            sx={{
              fontSize: '0.6875rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: '#0EA5E9'
            }}
          >
            Exam Information
          </Typography>
        </Box>

        {/* Info grid */}
        <Grid container spacing={2}>
          <Grid size={3}>
            <InfoItem label={examType.label} value={examType.value} />
          </Grid>
          <Grid size={3}>
            <InfoItem label={model.label} value={model.value} />
          </Grid>
          <Grid size={3}>
            <InfoItem label={gpu.label} value={gpu.value} />
          </Grid>
          <Grid size={3}>
            <InfoItem label="Number of repetition" value={`${numberOfRepetition} time`} />
          </Grid>
          <Grid size={3}>
            <InfoItem label={dataset.label} value={dataset.value} />
          </Grid>
          <Grid size={3}>
            <InfoItem label={precision.label} value={precision.value} />
          </Grid>
          <Grid size={3}>
            <InfoItem label={cpu.label} value={`${cpu.value} core`} />
          </Grid>
          <Grid size={3}>
            <InfoItem label={startTime.label} value={startTime.value} />
          </Grid>
          <Grid size={3}>
            <InfoItem label={dataNumber.label} value={dataNumber.value} />
          </Grid>
          <Grid size={3}>
            <InfoItem label={framework.label} value={framework.value} />
          </Grid>
          <Grid size={3}>
            <InfoItem label={ram.label} value={`${ram.value} GB`} />
          </Grid>
          <Grid size={3}>
            <InfoItem label={endTime.label} value={endTime.value} />
          </Grid>
        </Grid>
      </Box>
    </Box>
  );
});
