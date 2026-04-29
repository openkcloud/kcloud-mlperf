import { useEffect, useMemo, useState } from 'react';
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
  Tooltip,
  Typography
} from '@mui/material';
import { httpClient } from '@/libs/http-client';
import {
  DISABLED_REASON_LABEL,
  SweepApi,
  type SweepDisabledReason,
  type SweepOptionFlag,
  type SweepOptionsResponse
} from '@/api/sweep';

// ----------------------------------------------------------------------

const FALLBACK_BATCH_SIZES = [1, 2, 4, 8] as const;
const FALLBACK_CONCURRENCIES = [1, 2, 4] as const;
const FALLBACK_PRECISIONS: SweepOptionFlag[] = [
  { key: 'fp8', label: 'FP8', enabled: false, disabled_reason: 'feature_flag_off' },
  { key: 'bf16', label: 'BF16', enabled: false, disabled_reason: 'feature_flag_off' }
];
const FALLBACK_SCENARIOS: SweepOptionFlag[] = [
  { key: 'offline', label: 'Offline', enabled: false, disabled_reason: 'feature_flag_off' },
  { key: 'server', label: 'Server', enabled: false, disabled_reason: 'feature_flag_off' }
];

type SweepFormValues = {
  precisions: string[];
  batchSizes: number[];
  concurrencies: number[];
  scenarios: string[];
  benchmarks: string[];
  hardware: string[];
};

const calcCells = (v: SweepFormValues) =>
  v.precisions.length *
  v.batchSizes.length *
  v.concurrencies.length *
  v.scenarios.length *
  Math.max(1, v.benchmarks.length) *
  Math.max(1, v.hardware.length);

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
          setIsAdmin(false);
        } else {
          setAdminCheckError('Could not verify admin status — try again');
          setIsAdmin(false);
        }
      });
  }, []);

  return { isAdmin, adminCheckError };
};

// Loads /api/gpu-sweep/options. On failure we still render a complete
// catalogue marked as disabled — the page must NEVER be silently empty.
const useSweepOptions = () => {
  const [options, setOptions] = useState<SweepOptionsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    SweepApi.options()
      .then((res) => {
        if (!cancelled) setOptions(res);
      })
      .catch((err: any) => {
        if (cancelled) return;
        setLoadError(
          err?.response?.statusText || err?.message || 'Failed to load sweep options'
        );
        // Fallback: always render every category so operators can read which
        // option exists and why it's disabled, even when the API is unreachable.
        setOptions({
          enabled: false,
          feature_flag_reason: 'feature_flag_off',
          benchmarks: [
            { key: 'mlperf-perf', label: 'MLPerf performance', enabled: false, disabled_reason: 'feature_flag_off' },
            { key: 'mlperf-acc', label: 'MLPerf accuracy', enabled: false, disabled_reason: 'feature_flag_off' },
            { key: 'mmlu-pro', label: 'MMLU-Pro', enabled: false, disabled_reason: 'feature_flag_off' },
            { key: 'tt100', label: 'TT100', enabled: false, disabled_reason: 'feature_flag_off' }
          ],
          hardware: [
            { key: 'gpu-nvidia', label: 'NVIDIA GPU', vendor: 'nvidia', node: 'node2,node3', enabled: false, disabled_reason: 'feature_flag_off' },
            { key: 'npu-rngd', label: 'Furiosa RNGD NPU (node4)', vendor: 'furiosa', node: 'node4', enabled: false, disabled_reason: 'feature_flag_off' },
            { key: 'npu-rebellions-atomplus', label: 'Rebellions Atom+ NPU (node5)', vendor: 'rebellions', node: 'node5', enabled: false, disabled_reason: 'node_pending_join' }
          ],
          nodes: [
            { name: 'node2', state: 'active', enabled: false, disabled_reason: 'feature_flag_off' },
            { name: 'node3', state: 'active', enabled: false, disabled_reason: 'feature_flag_off' },
            { name: 'node4', state: 'active', enabled: false, disabled_reason: 'feature_flag_off' },
            { name: 'node5', state: 'pending_join', enabled: false, disabled_reason: 'node_pending_join' }
          ],
          models: [
            {
              key: 'llama-3.1-8b-instruct',
              label: 'Llama-3.1-8B-Instruct',
              precisions: ['fp8', 'bf16'],
              enabled: false,
              disabled_reason: 'feature_flag_off'
            }
          ],
          precisions: FALLBACK_PRECISIONS,
          scenarios: FALLBACK_SCENARIOS,
          batch_sizes: [...FALLBACK_BATCH_SIZES],
          concurrencies: [...FALLBACK_CONCURRENCIES]
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { options, loadError };
};

// ----------------------------------------------------------------------

type SweepStatus = 'idle' | 'submitting' | 'success' | 'error';

const SweepControlPage = () => {
  const { isAdmin, adminCheckError } = useIsAdmin();
  const { options, loadError } = useSweepOptions();
  const [status, setStatus] = useState<SweepStatus>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [snackbarMsg, setSnackbarMsg] = useState<string | null>(null);

  const enabledFromServer = options?.enabled ?? false;

  const { control, watch, handleSubmit } = useForm<SweepFormValues>({
    defaultValues: {
      precisions: ['fp8'],
      batchSizes: [1],
      concurrencies: [1],
      scenarios: ['offline'],
      benchmarks: ['mlperf-perf'],
      hardware: ['gpu-nvidia']
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

  const headerBanner = useMemo(() => {
    if (!options) return null;
    if (options.feature_flag_reason === 'feature_flag_off') {
      return (
        <Alert severity="warning" sx={{ mb: 2 }} data-testid="feature-flag-banner">
          <Typography fontWeight={700}>
            GPU Sweep disabled in this environment (read-only catalogue).
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            Set <code>GPU_SWEEP_ENABLED=true</code> on the API server to enable.
            Options below are shown so you can inspect what would be available.
          </Typography>
        </Alert>
      );
    }
    return null;
  }, [options]);

  if (isAdmin === null || options === null) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  // Read-only when the user is not an admin OR the feature flag is off OR the
  // backend rejected the options call (loadError). The catalogue is still
  // rendered with reasons in every case.
  const readOnly = !isAdmin || !enabledFromServer;

  return (
    <Box sx={{ maxWidth: 960 }} data-testid="sweep-control-page">
      <Typography variant="h5" fontWeight={700} sx={{ mb: 0.5 }}>
        GPU Sweep Control
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Configure and launch a benchmark sweep across all GPU and NPU nodes.
        {readOnly && (
          <Chip
            label={!isAdmin ? 'Read-only — admin required' : 'Read-only — feature flag off'}
            size="small"
            color="warning"
            sx={{ ml: 1 }}
          />
        )}
      </Typography>

      {headerBanner}

      {loadError && (
        <Alert severity="error" sx={{ mb: 2 }} data-testid="options-load-error">
          {loadError}. Showing fallback options.
        </Alert>
      )}

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

      <Paper sx={{ p: 3, mb: 3 }} data-testid="sweep-options-grid">
        <Stack spacing={3}>
          <FlagCheckboxGroup
            control={control}
            name="benchmarks"
            label="Benchmark"
            flags={options.benchmarks}
            readOnly={readOnly}
            testId="opt-benchmarks"
          />

          <FlagCheckboxGroup
            control={control}
            name="hardware"
            label="Hardware"
            flags={options.hardware}
            readOnly={readOnly}
            testId="opt-hardware"
          />

          <NodeStrip nodes={options.nodes} />

          <ModelStrip models={options.models} />

          <FlagCheckboxGroup
            control={control}
            name="precisions"
            label="Precision"
            flags={options.precisions}
            readOnly={readOnly}
            testId="opt-precisions"
          />

          <FlagCheckboxGroup
            control={control}
            name="scenarios"
            label="Scenario"
            flags={options.scenarios}
            readOnly={readOnly}
            testId="opt-scenarios"
          />

          <NumberCheckboxGroup
            control={control}
            name="batchSizes"
            label="Batch sizes"
            options={options.batch_sizes}
            disabled={readOnly}
            testId="opt-batch-sizes"
          />

          <NumberCheckboxGroup
            control={control}
            name="concurrencies"
            label="Concurrencies"
            options={options.concurrencies}
            disabled={readOnly}
            testId="opt-concurrencies"
          />
        </Stack>
      </Paper>

      <Paper
        sx={{
          p: 2.5,
          mb: 3,
          bgcolor: cellCount > 0 ? '#F0FDF4' : '#FFF7ED',
          border: '1px solid',
          borderColor: cellCount > 0 ? '#BBF7D0' : '#FDE68A',
          borderRadius: 2
        }}
      >
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

type FlagCheckboxGroupProps = {
  control: ReturnType<typeof useForm<SweepFormValues>>['control'];
  name: keyof SweepFormValues;
  label: string;
  flags: SweepOptionFlag[];
  readOnly: boolean;
  testId: string;
};

const FlagCheckboxGroup = ({
  control,
  name,
  label,
  flags,
  readOnly,
  testId
}: FlagCheckboxGroupProps) => (
  <Box data-testid={testId}>
    <FormLabel sx={{ fontWeight: 600, fontSize: '0.875rem', color: '#1E293B' }}>{label}</FormLabel>
    <FormGroup row sx={{ mt: 0.5 }}>
      {flags.map((flag) => (
        <Controller
          key={flag.key}
          control={control}
          name={name}
          render={({ field }) => {
            const arr = field.value as string[];
            const checked = arr.includes(flag.key);
            const disabled = readOnly || !flag.enabled;
            const reasonKey: SweepDisabledReason | null = !flag.enabled
              ? flag.disabled_reason ?? 'feature_flag_off'
              : null;
            const tooltip = reasonKey ? DISABLED_REASON_LABEL[reasonKey] : '';
            const labelNode = (
              <Stack direction="row" alignItems="center" spacing={1}>
                <span>{flag.label}</span>
                {!flag.enabled && reasonKey && (
                  <Chip
                    label={reasonKey.replaceAll('_', ' ')}
                    size="small"
                    color="default"
                    variant="outlined"
                    data-testid={`reason-${flag.key}`}
                  />
                )}
              </Stack>
            );
            const control = (
              <Checkbox
                size="small"
                checked={checked}
                disabled={disabled}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...arr, flag.key]
                    : arr.filter((v) => v !== flag.key);
                  field.onChange(next);
                }}
              />
            );
            const inner = (
              <FormControlLabel
                disabled={disabled}
                data-testid={`flag-${flag.key}`}
                data-disabled={disabled ? 'true' : 'false'}
                data-disabled-reason={reasonKey ?? ''}
                control={control}
                label={labelNode}
              />
            );
            // Tooltip wrapping a disabled control: wrap in span so the tooltip
            // still triggers (MUI requirement for disabled children).
            return tooltip ? (
              <Tooltip title={tooltip} arrow placement="top">
                <span>{inner}</span>
              </Tooltip>
            ) : (
              inner
            );
          }}
        />
      ))}
    </FormGroup>
  </Box>
);

type NumberCheckboxGroupProps = {
  control: ReturnType<typeof useForm<SweepFormValues>>['control'];
  name: keyof SweepFormValues;
  label: string;
  options: number[];
  disabled: boolean;
  testId: string;
};

const NumberCheckboxGroup = ({
  control,
  name,
  label,
  options,
  disabled,
  testId
}: NumberCheckboxGroupProps) => (
  <Box data-testid={testId}>
    <FormLabel sx={{ fontWeight: 600, fontSize: '0.875rem', color: '#1E293B' }}>{label}</FormLabel>
    <FormGroup row sx={{ mt: 0.5 }}>
      {options.map((opt) => (
        <Controller
          key={String(opt)}
          control={control}
          name={name}
          render={({ field }) => {
            const arr = field.value as number[];
            const checked = arr.includes(opt);
            return (
              <FormControlLabel
                disabled={disabled}
                data-testid={`num-${name}-${opt}`}
                control={
                  <Checkbox
                    size="small"
                    checked={checked}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...arr, opt]
                        : arr.filter((v) => v !== opt);
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

const NodeStrip = ({ nodes }: { nodes: SweepOptionsResponse['nodes'] }) => (
  <Box data-testid="opt-nodes">
    <FormLabel sx={{ fontWeight: 600, fontSize: '0.875rem', color: '#1E293B' }}>
      Nodes
    </FormLabel>
    <Stack direction="row" spacing={1} sx={{ mt: 0.75, flexWrap: 'wrap', rowGap: 1 }}>
      {nodes.map((n) => {
        const reasonKey = !n.enabled ? n.disabled_reason ?? 'feature_flag_off' : null;
        const tooltip = reasonKey ? DISABLED_REASON_LABEL[reasonKey] : '';
        const chip = (
          <Chip
            label={`${n.name} · ${n.state}`}
            size="small"
            color={n.enabled ? 'success' : 'default'}
            variant={n.enabled ? 'filled' : 'outlined'}
            data-testid={`node-${n.name}`}
            data-state={n.state}
            data-disabled-reason={reasonKey ?? ''}
          />
        );
        return tooltip ? (
          <Tooltip key={n.name} title={tooltip} arrow placement="top">
            <span>{chip}</span>
          </Tooltip>
        ) : (
          <span key={n.name}>{chip}</span>
        );
      })}
    </Stack>
  </Box>
);

const ModelStrip = ({ models }: { models: SweepOptionsResponse['models'] }) => (
  <Box data-testid="opt-models">
    <FormLabel sx={{ fontWeight: 600, fontSize: '0.875rem', color: '#1E293B' }}>
      Model
    </FormLabel>
    <Stack direction="row" spacing={1} sx={{ mt: 0.75, flexWrap: 'wrap', rowGap: 1 }}>
      {models.map((m) => {
        const reasonKey = !m.enabled ? m.disabled_reason ?? 'feature_flag_off' : null;
        const tooltip = reasonKey ? DISABLED_REASON_LABEL[reasonKey] : '';
        const chip = (
          <Chip
            label={`${m.label} (${m.precisions.join(', ')})`}
            size="small"
            color={m.enabled ? 'primary' : 'default'}
            variant={m.enabled ? 'filled' : 'outlined'}
            data-testid={`model-${m.key}`}
            data-disabled-reason={reasonKey ?? ''}
          />
        );
        return tooltip ? (
          <Tooltip key={m.key} title={tooltip} arrow placement="top">
            <span>{chip}</span>
          </Tooltip>
        ) : (
          <span key={m.key}>{chip}</span>
        );
      })}
    </Stack>
  </Box>
);

export default SweepControlPage;
