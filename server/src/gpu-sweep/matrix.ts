import { GpuSweepCellKind } from './entities/gpu-sweep-cell.entity';
import { SweepCellSpec, SweepTimelineEntry } from './dto/gpu-sweep.dto';

// SKU → (node, gpu_index). The 4 SKUs are physically pinned by node and slot per
// the cluster `kubectl get nodes -o json` snapshot referenced in the ralplan.
export interface SkuPlacement {
  gpu_type: string;
  node: 'node2' | 'node3';
  gpu_index: 0 | 1;
}

export const SKU_PLACEMENTS: SkuPlacement[] = [
  { gpu_type: 'NVIDIA-L40', node: 'node2', gpu_index: 0 },
  { gpu_type: 'NVIDIA-A40', node: 'node2', gpu_index: 1 },
  { gpu_type: 'NVIDIA-L40-44GiB', node: 'node3', gpu_index: 0 },
  { gpu_type: 'NVIDIA-A40-44GiB', node: 'node3', gpu_index: 1 },
];

// Per-node "matched pair" SKUs that allow TP=2 (only same-SKU pairs qualify).
// Per ralplan, only the L40 pair on node2 and the L40-44GiB pair on node3 qualify.
const TP2_ALLOWED_SKUS = new Set(['NVIDIA-L40', 'NVIDIA-L40-44GiB']);

export const MLPERF_SAMPLE_SIZES = [100, 500, 1338, 13368];
export const MMLU_SAMPLE_SIZES = [25, 100]; // per-subject
export const PRECISIONS = ['bf16', 'fp8'] as const;
export const MLPERF_BATCH_SIZES = [1, 4];
export const MLPERF_SCENARIOS = ['offline', 'server'] as const;

export const CANONICAL_CELL = {
  gpu_type: 'NVIDIA-L40',
  precision: 'fp8' as const,
  batch_size: 1,
  data_number: 500,
  tensor_parallel_size: 1,
  scenario: 'offline' as const,
};

// 20-cell hand-curated dedup. Each excluded cell is dominated by another cell
// already kept in the same row of the materialized matrix (i.e. the surviving
// cell already captures the same signal). Five dedup groups, four SKUs each:
// 5 × 4 = 20 cells, taking the post-trim 116 → final 110.
// (Original plan target was 96; the realized trim + FP8/Ampere fallback handling
// yields 110. 110 is the canonical count — see AGENTS.md "Matrix structure".)
//
// The groups are chosen so DEDUP_KEYS ∩ matrix is exactly 20 (each excluded
// cell actually exists in the post-trim matrix, since the goal is to remove
// real cells, not duplicate the trim rules).
export const DEDUP_KEYS = (() => {
  const keys: string[] = [];
  for (const sku of SKU_PLACEMENTS) {
    // Group 1 (×4 SKU): mlperf bf16 bs=1 n=500 server
    //   dominated by bf16 bs=1 n=13368 server (warm-up dominates n=500 server)
    keys.push(
      buildCellKey({
        kind: GpuSweepCellKind.MLPERF,
        gpu_type: sku.gpu_type,
        precision: 'bf16',
        batch_size: 1,
        data_number: 500,
        tensor_parallel_size: 1,
        scenario: 'server',
      }),
    );
    // Group 2 (×4 SKU): mlperf bf16 bs=4 n=500 offline
    //   dominated by bs=4 n=13368 offline (sub-full bs=4 noise)
    keys.push(
      buildCellKey({
        kind: GpuSweepCellKind.MLPERF,
        gpu_type: sku.gpu_type,
        precision: 'bf16',
        batch_size: 4,
        data_number: 500,
        tensor_parallel_size: 1,
        scenario: 'offline',
      }),
    );
    // Group 3 (×4 SKU): mlperf bf16 bs=4 n=100 offline
    //   dominated by bs=4 n=13368 offline (warm-up dominates small-bs=4)
    keys.push(
      buildCellKey({
        kind: GpuSweepCellKind.MLPERF,
        gpu_type: sku.gpu_type,
        precision: 'bf16',
        batch_size: 4,
        data_number: 100,
        tensor_parallel_size: 1,
        scenario: 'offline',
      }),
    );
    // Group 4 (×4 SKU): mlperf fp8 bs=1 n=100 offline
    //   dominated by fp8 bs=1 n=13368 offline (small-sample fp8 == warm-up)
    keys.push(
      buildCellKey({
        kind: GpuSweepCellKind.MLPERF,
        gpu_type: sku.gpu_type,
        precision: 'fp8',
        batch_size: 1,
        data_number: 100,
        tensor_parallel_size: 1,
        scenario: 'offline',
      }),
    );
    // Group 5 (×4 SKU): mlperf bf16 bs=1 n=1338 server
    //   dominated by bf16 bs=1 n=13368 server (mid-sample server bandwidth-bound)
    keys.push(
      buildCellKey({
        kind: GpuSweepCellKind.MLPERF,
        gpu_type: sku.gpu_type,
        precision: 'bf16',
        batch_size: 1,
        data_number: 1338,
        tensor_parallel_size: 1,
        scenario: 'server',
      }),
    );
  }
  return keys;
})();

interface CellKeyInput {
  kind: GpuSweepCellKind;
  gpu_type: string;
  precision: string;
  batch_size: number;
  data_number: number;
  tensor_parallel_size: number;
  scenario: string;
}

export function buildCellKey(input: CellKeyInput): string {
  return [
    input.kind,
    input.gpu_type,
    input.precision,
    `bs${input.batch_size}`,
    `n${input.data_number}`,
    `tp${input.tensor_parallel_size}`,
    input.scenario,
  ].join('|');
}

export interface MatrixOptions {
  gpu_skus?: string[];
  benchmarks?: ('mlperf' | 'mmlu')[];
  precisions?: ('bf16' | 'fp8')[];
}

// Trim rules per ralplan Sweep Matrix section. Returns true if the candidate
// cell should be DROPPED (i.e. one of the 6 trim rules applies).
function shouldDropByTrimRule(cell: SweepCellSpec): boolean {
  // Rule 1: TP=2 only on L40 (node2) and L40-44GiB (node3).
  if (cell.tensor_parallel_size === 2 && !TP2_ALLOWED_SKUS.has(cell.gpu_type)) {
    return true;
  }
  // Rule 2: drop mlperf server@1qps for data_number<500.
  if (
    cell.kind === GpuSweepCellKind.MLPERF &&
    cell.scenario === 'server' &&
    cell.data_number < 500
  ) {
    return true;
  }
  // Rule 3: drop fp8+bs=4 on A40* SKUs (no FP8 tensor cores on Ampere).
  if (
    cell.kind === GpuSweepCellKind.MLPERF &&
    cell.precision === 'fp8' &&
    cell.batch_size === 4 &&
    cell.gpu_type.startsWith('NVIDIA-A40')
  ) {
    return true;
  }
  // Rule 4: drop mmlu × 25/subj on bf16 (keep on fp8).
  if (
    cell.kind === GpuSweepCellKind.MMLU &&
    cell.data_number === 25 &&
    cell.precision === 'bf16'
  ) {
    return true;
  }
  // Rule 5: drop mlperf server@1qps × bs=4 (server only at bs=1).
  if (
    cell.kind === GpuSweepCellKind.MLPERF &&
    cell.scenario === 'server' &&
    cell.batch_size === 4
  ) {
    return true;
  }
  // Rule 6: dedup bf16 bs=1 n=100 on mlperf -- keep n=500 only.
  if (
    cell.kind === GpuSweepCellKind.MLPERF &&
    cell.precision === 'bf16' &&
    cell.batch_size === 1 &&
    cell.data_number === 100
  ) {
    return true;
  }
  return false;
}

export function expandMatrix(options: MatrixOptions = {}): SweepCellSpec[] {
  const skuFilter = options.gpu_skus ? new Set(options.gpu_skus) : null;
  const benchmarks = new Set(options.benchmarks ?? ['mlperf', 'mmlu']);
  const precisions = options.precisions ?? ['bf16', 'fp8'];

  const skus = SKU_PLACEMENTS.filter((s) =>
    skuFilter ? skuFilter.has(s.gpu_type) : true,
  );

  const cells: SweepCellSpec[] = [];
  const dedupSet = new Set(DEDUP_KEYS);

  for (const sku of skus) {
    // ---- MLPERF axis ----
    if (benchmarks.has('mlperf')) {
      for (const precision of precisions) {
        for (const batch_size of MLPERF_BATCH_SIZES) {
          for (const data_number of MLPERF_SAMPLE_SIZES) {
            for (const scenario of MLPERF_SCENARIOS) {
              for (const tp of [1, 2]) {
                if (tp === 2 && !TP2_ALLOWED_SKUS.has(sku.gpu_type)) continue;
                const cell: SweepCellSpec = {
                  cell_key: buildCellKey({
                    kind: GpuSweepCellKind.MLPERF,
                    gpu_type: sku.gpu_type,
                    precision,
                    batch_size,
                    data_number,
                    tensor_parallel_size: tp,
                    scenario,
                  }),
                  kind: GpuSweepCellKind.MLPERF,
                  gpu_type: sku.gpu_type,
                  node: sku.node,
                  gpu_index: sku.gpu_index,
                  precision,
                  batch_size,
                  data_number,
                  tensor_parallel_size: tp,
                  scenario,
                  retry_num: 3,
                };
                if (shouldDropByTrimRule(cell)) continue;
                if (dedupSet.has(cell.cell_key)) continue;
                cells.push(cell);
              }
            }
          }
        }
      }
    }

    // ---- MMLU axis ----
    if (benchmarks.has('mmlu')) {
      for (const precision of precisions) {
        for (const data_number of MMLU_SAMPLE_SIZES) {
          const cell: SweepCellSpec = {
            cell_key: buildCellKey({
              kind: GpuSweepCellKind.MMLU,
              gpu_type: sku.gpu_type,
              precision,
              batch_size: 1,
              data_number,
              tensor_parallel_size: 1,
              scenario: 'offline',
            }),
            kind: GpuSweepCellKind.MMLU,
            gpu_type: sku.gpu_type,
            node: sku.node,
            gpu_index: sku.gpu_index,
            precision,
            batch_size: 1,
            data_number,
            tensor_parallel_size: 1,
            scenario: 'offline',
            retry_num: 3,
          };
          if (shouldDropByTrimRule(cell)) continue;
          if (dedupSet.has(cell.cell_key)) continue;
          cells.push(cell);
        }
      }
    }
  }

  return cells;
}

// Rough per-cell wall-time estimate (seconds), used only for the Phase -1 Gantt
// preview. Calibrated from existing cluster measurements: TT100T ~1.6s on L40
// fp8 n=500, scaled by data_number.
function estimateDurationSeconds(cell: SweepCellSpec): number {
  const baseSecondsPerSample = cell.precision === 'fp8' ? 0.018 : 0.024;
  const samples =
    cell.kind === GpuSweepCellKind.MLPERF
      ? cell.data_number
      : cell.data_number * 57; // MMLU: per-subject × 57 subjects
  const setupOverhead = 90; // operator preroll + image pull
  return (
    setupOverhead +
    Math.max(60, samples * baseSecondsPerSample) * cell.retry_num
  );
}

const STAGGER_SECONDS = 60;

export function buildTimeline(cells: SweepCellSpec[]): {
  node2: SweepTimelineEntry[];
  node3: SweepTimelineEntry[];
} {
  const perNode: Record<'node2' | 'node3', SweepTimelineEntry[]> = {
    node2: [],
    node3: [],
  };
  const nodeCursor: Record<'node2' | 'node3', number> = { node2: 0, node3: 0 };

  for (const cell of cells) {
    const cursor = nodeCursor[cell.node];
    const duration = estimateDurationSeconds(cell);
    perNode[cell.node].push({
      cell_key: cell.cell_key,
      node: cell.node,
      gpu_type: cell.gpu_type,
      scheduled_offset_seconds: cursor,
      estimated_duration_seconds: duration,
    });
    nodeCursor[cell.node] = cursor + duration + STAGGER_SECONDS;
  }

  return perNode;
}
