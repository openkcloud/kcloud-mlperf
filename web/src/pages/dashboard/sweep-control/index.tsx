import { useEffect, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';

import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  FormControlLabel,
  FormGroup,
  FormLabel,
  Paper,
  Snackbar,
  Stack,
  Typography
} from '@mui/material';
import { httpClient } from '@/libs/http-client';

// ----------------------------------------------------------------------

const PRECISION_OPTIONS = ['bf16', 'fp8'] as const;
const BATCH_SIZE_OPTIONS = [1, 4, 8, 16] as const;
const SAMPLE_SIZE_OPTIONS = [500, 1000, 2000] as const;
const SCENARIO_OPTIONS = ['offline', 'server'] as const;
const TP_OPTIONS = [1, 2] as const;

type SweepFormValues = {
  precisions: string[];
  batchSizes: number[];
  sampleSizes: number[];
  scenarios: string[];
  tpSizes: number[];
};

// cells = |precisions| × |batchSizes| × |sampleSizes| × |scenarios| × |tpSizes|
const calcCells = (v: SweepFormValues) =>
  v.precisions.length * v.batchSizes.length * v.sampleSizes.length * v.scenarios.length * v.tpSizes.length;

// rough estimate: 5 min per cell
const formatDuration = (cells: number) => {
  const minutes = cells * 5;
  if (minutes < 60) return `~${minutes} min`;
  return `~${(minutes / 60).toFixed(1)} hr`;
};

// ----------------------------------------------------------------------

const useIsAdmin = () => {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [adminCheckError, setAdminCheckError] = useState<string | null>(null);

  useEffect(() => {
    httpClient
      .get('/auth/me')
      .then((res: any) => setIsAdmin(res?.role === 'admin'))
      .catch((err: any) => {
        const status = err?.response?.status;
        if (status === 401 || status === 403) {
          // Legitimately not an admin — no error banner needed
          setIsAdmin(false);
        } else {
          // Network or unexpected error
          setAdminCheckError('Could not verify admin status — try again');
          setIsAdmin(false);
        }
      });
  }, []);

  return { isAdmin, adminCheckError };
};

// ----------------------------------------------------------------------

type SweepStatus = 'idle' | 'submitting' | 'success' | 'error';

const SweepControlPage = () => {
  const { isAdmin, adminCheckError } = useIsAdmin();
  const sweepEnabled = import.meta.env.VITE__GPU_SWEEP_ENABLED === 'true';
  const [status, setStatus] = useState<SweepStatus>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [snackbarMsg, setSnackbarMsg] = useState<string | null>(null);

  const { control, watch, handleSubmit } = useForm<SweepFormValues>({
    defaultValues: {
      precisions: ['bf16', 'fp8'],
      batchSizes: [1],
      sampleSizes: [500],
      scenarios: ['offline'],
      tpSizes: [1]
    }
  });

  const values = watch();
  const cellCount = calcCells(values);

  const submit = async (mode: 'full' | 'calibration') => {
    setStatus('submitting');
    setErrorMsg('');
    try {
      await httpClient.post('/gpu-sweep/start', { mode, matrix: values });
      setStatus('success');
    } catch (e: any) {
      setErrorMsg(e?.message ?? 'Unknown error');
      setStatus('error');
    }
  };

  const sendPatch = async (action: 'pause' | 'drain') => {
    try {
      await httpClient.patch(`/gpu-sweep/${action}`);
    } catch (e: any) {
      setSnackbarMsg(e?.message ?? `Failed to ${action} sweep — please try again`);
    }
  };

  if (!sweepEnabled) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning" sx={{ mb: 2 }}>
          <Typography fontWeight={700}>GPU Sweep disabled in this environment.</Typography>
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            Set <code>VITE__GPU_SWEEP_ENABLED=true</code> (staging) to enable sweep controls.
          </Typography>
        </Alert>
      </Box>
    );
  }

  if (isAdmin === null) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  const readOnly = !isAdmin;

  return (
    <Box sx={{ maxWidth: 720 }}>
      <Typography variant="h5" fontWeight={700} sx={{ mb: 0.5 }}>
        GPU Sweep Control
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Configure and launch a benchmark sweep across all GPU nodes.
        {readOnly && (
          <Chip label="Read-only — admin required" size="small" color="warning" sx={{ ml: 1 }} />
        )}
      </Typography>

      {adminCheckError && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {adminCheckError}
        </Alert>
      )}

      {status === 'success' && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setStatus('idle')}>
          Sweep started successfully.
        </Alert>
      )}
      {status === 'error' && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setStatus('idle')}>
          {errorMsg}
        </Alert>
      )}

      <Paper sx={{ p: 3, mb: 3 }}>
        <Stack spacing={3}>
          <CheckboxGroup
            control={control}
            name="precisions"
            label="Precision"
            options={PRECISION_OPTIONS as unknown as string[]}
            disabled={readOnly}
          />
          <CheckboxGroup
            control={control}
            name="batchSizes"
            label="Batch sizes"
            options={BATCH_SIZE_OPTIONS as unknown as number[]}
            disabled={readOnly}
          />
          <CheckboxGroup
            control={control}
            name="sampleSizes"
            label="Sample sizes"
            options={SAMPLE_SIZE_OPTIONS as unknown as number[]}
            disabled={readOnly}
          />
          <CheckboxGroup
            control={control}
            name="scenarios"
            label="Scenarios"
            options={SCENARIO_OPTIONS as unknown as string[]}
            disabled={readOnly}
          />
          <CheckboxGroup
            control={control}
            name="tpSizes"
            label="Tensor parallel"
            options={TP_OPTIONS as unknown as number[]}
            disabled={readOnly}
          />
        </Stack>
      </Paper>

      <Paper sx={{ p: 2.5, mb: 3, bgcolor: cellCount > 0 ? '#F0FDF4' : '#FFF7ED', border: '1px solid', borderColor: cellCount > 0 ? '#BBF7D0' : '#FDE68A', borderRadius: 2 }}>
        <Typography fontWeight={700} sx={{ color: '#0F172A' }}>
          {cellCount > 0
            ? `This config would run ${cellCount} cells over ${formatDuration(cellCount)}`
            : 'Select at least one value per axis'}
        </Typography>
      </Paper>

      {!readOnly && (
        <Stack direction="row" spacing={2} flexWrap="wrap">
          <Button
            variant="contained"
            disabled={cellCount === 0 || status === 'submitting'}
            onClick={handleSubmit(() => submit('full'))}
            sx={{ bgcolor: '#4F46E5', '&:hover': { bgcolor: '#4338CA' } }}
          >
            {status === 'submitting' ? <CircularProgress size={18} sx={{ color: '#fff' }} /> : 'Start full sweep'}
          </Button>
          <Button
            variant="outlined"
            disabled={status === 'submitting'}
            onClick={handleSubmit(() => submit('calibration'))}
          >
            Run calibration
          </Button>
          <Button variant="outlined" color="warning" onClick={() => sendPatch('pause')}>
            Pause
          </Button>
          <Button variant="outlined" color="error" onClick={() => sendPatch('drain')}>
            Drain
          </Button>
        </Stack>
      )}

      <Snackbar
        open={snackbarMsg !== null}
        autoHideDuration={5000}
        onClose={() => setSnackbarMsg(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" onClose={() => setSnackbarMsg(null)} sx={{ width: '100%' }}>
          {snackbarMsg}
        </Alert>
      </Snackbar>
    </Box>
  );
};

// ----------------------------------------------------------------------

type CheckboxGroupProps<T extends string | number> = {
  control: ReturnType<typeof useForm<SweepFormValues>>['control'];
  name: keyof SweepFormValues;
  label: string;
  options: T[];
  disabled: boolean;
};

const CheckboxGroup = <T extends string | number>({
  control,
  name,
  label,
  options,
  disabled
}: CheckboxGroupProps<T>) => (
  <Box>
    <FormLabel sx={{ fontWeight: 600, fontSize: '0.875rem', color: '#1E293B' }}>{label}</FormLabel>
    <FormGroup row sx={{ mt: 0.5 }}>
      {options.map(opt => (
        <Controller
          key={String(opt)}
          control={control}
          name={name}
          render={({ field }) => {
            const checked = (field.value as T[]).includes(opt);
            return (
              <FormControlLabel
                disabled={disabled}
                control={
                  <Checkbox
                    size="small"
                    checked={checked}
                    onChange={e => {
                      const next = e.target.checked
                        ? [...(field.value as T[]), opt]
                        : (field.value as T[]).filter(v => v !== opt);
                      field.onChange(next);
                    }}
                  />
                }
                label={String(opt)}
              />
            );
          }}
        />
      ))}
    </FormGroup>
  </Box>
);

export default SweepControlPage;
