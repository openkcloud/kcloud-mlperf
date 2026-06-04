/**
 * US-005 — Latency-context disclosure tests.
 *
 * Asserts that:
 *  1) LatencyMeasurementContext enum is defined and exported with the
 *     three documented members.
 *  2) MpExamResult / MmExamResult / NpuExamResult entities have a
 *     latency_measurement_context column.
 *  3) computeIncompatibilityReasons() flags the GPU CLIENT_WALL_CLOCK vs
 *     NPU SERVER_TOKEN_STREAM case as 'latency_context_mismatch'.
 */
import { getMetadataArgsStorage } from 'typeorm';
import { LatencyMeasurementContext } from '../enums/latency-measurement-context.enum';
import {
  computeIncompatibilityReasons,
  type NormalizedRun,
} from './comparison.service';
import { MpExamResult } from '../entities/mp-exam-result.entity';
import { MmExamResult } from '../entities/mm-exam-result.entity';
import { NpuExamResult } from '../entities/npu-exam-result.entity';
import { StatusEnum } from '../enums/status.enum';

function entityHasColumn(target: any, name: string): boolean {
  return getMetadataArgsStorage()
    .columns.filter((c) => c.target === target)
    .some((c) => c.propertyName === name);
}

const baseRun = (over: Partial<NormalizedRun> = {}): NormalizedRun => ({
  id: 1,
  benchmark: 'mlperf',
  name: 'r1',
  model: 'meta-llama/Llama-3.1-8B-Instruct',
  hardware: {
    type: 'gpu',
    vendor: 'nvidia',
    model: 'NVIDIA-L40',
    canonical: 'L40',
    node: 'node2',
  },
  status: StatusEnum.COMPLETED,
  started_at: null,
  completed_at: null,
  elapsed_seconds: null,
  metrics: {
    tt100t_seconds: 1.5,
    tps: 70,
    accuracy_pct: null,
    throughput: null,
  },
  artifacts: [],
  precision: 'FP8',
  scenario: 'Offline',
  batch_size: 1,
  dataset: 'cnn_eval',
  data_number: 13368,
  max_output_tokens: 128,
  source_table: 'mp_exam',
  failure_reason: null,
  config_fingerprint: 'fp-1',
  drift_flag: false,
  is_canonical: true,
  precision_mismatch: false,
  latency_measurement_context: LatencyMeasurementContext.CLIENT_WALL_CLOCK,
  ...over,
});

describe('LatencyMeasurementContext enum (US-005)', () => {
  it('has CLIENT_WALL_CLOCK / SERVER_TOKEN_STREAM / UNKNOWN members', () => {
    expect(LatencyMeasurementContext.CLIENT_WALL_CLOCK).toBe(
      'CLIENT_WALL_CLOCK',
    );
    expect(LatencyMeasurementContext.SERVER_TOKEN_STREAM).toBe(
      'SERVER_TOKEN_STREAM',
    );
    expect(LatencyMeasurementContext.UNKNOWN).toBe('UNKNOWN');
  });
});

describe('Result entities — latency_measurement_context column (US-005)', () => {
  test('MpExamResult declares latency_measurement_context', () => {
    expect(entityHasColumn(MpExamResult, 'latency_measurement_context')).toBe(
      true,
    );
  });
  test('MmExamResult declares latency_measurement_context', () => {
    expect(entityHasColumn(MmExamResult, 'latency_measurement_context')).toBe(
      true,
    );
  });
  test('NpuExamResult declares latency_measurement_context', () => {
    expect(entityHasColumn(NpuExamResult, 'latency_measurement_context')).toBe(
      true,
    );
  });
});

describe('computeIncompatibilityReasons — latency_context_mismatch (US-005)', () => {
  it('appends "latency_context_mismatch" for GPU CLIENT_WALL_CLOCK vs NPU SERVER_TOKEN_STREAM', () => {
    const a = baseRun({
      latency_measurement_context: LatencyMeasurementContext.CLIENT_WALL_CLOCK,
    });
    const b = baseRun({
      id: 2,
      latency_measurement_context:
        LatencyMeasurementContext.SERVER_TOKEN_STREAM,
      hardware: {
        type: 'npu',
        vendor: 'furiosa',
        model: 'RNGD',
        canonical: 'RNGD',
        node: 'node4',
      },
    });
    const reasons = computeIncompatibilityReasons(a, b);
    expect(reasons).toContain('latency_context_mismatch');
  });

  it('does NOT append latency_context_mismatch when one side is UNKNOWN', () => {
    const a = baseRun({
      latency_measurement_context: LatencyMeasurementContext.UNKNOWN,
    });
    const b = baseRun({
      id: 2,
      latency_measurement_context:
        LatencyMeasurementContext.SERVER_TOKEN_STREAM,
    });
    const reasons = computeIncompatibilityReasons(a, b);
    expect(reasons).not.toContain('latency_context_mismatch');
  });

  it('does NOT append latency_context_mismatch when both contexts are equal', () => {
    const a = baseRun({
      latency_measurement_context: LatencyMeasurementContext.CLIENT_WALL_CLOCK,
    });
    const b = baseRun({
      id: 2,
      latency_measurement_context: LatencyMeasurementContext.CLIENT_WALL_CLOCK,
    });
    const reasons = computeIncompatibilityReasons(a, b);
    expect(reasons).not.toContain('latency_context_mismatch');
  });
});
