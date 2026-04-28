import { expandMatrix, DEDUP_KEYS, SKU_PLACEMENTS, buildTimeline } from './matrix';
import { FIXTURE_CELL_COUNT } from './matrix.fixture';
import { GpuSweepMode } from './entities/gpu-sweep.entity';
import { GpuSweepCellKind } from './entities/gpu-sweep-cell.entity';

// ---------------------------------------------------------------------------
// Snapshot test — asserts the canonical 96-cell matrix.
// CI gate for Phase -1 acceptance criteria.
// ---------------------------------------------------------------------------

describe('matrix.fixture (snapshot)', () => {
  const cells = expandMatrix();

  it(`should contain exactly ${FIXTURE_CELL_COUNT} cells`, () => {
    expect(cells).toHaveLength(FIXTURE_CELL_COUNT);
  });

  it('each cell_key should be unique', () => {
    const keys = cells.map((c) => c.cell_key);
    const unique = new Set(keys);
    expect(unique.size).toBe(FIXTURE_CELL_COUNT);
  });

  it('should cover all 4 GPU SKUs', () => {
    const skus = new Set(cells.map((c) => c.gpu_type));
    for (const placement of SKU_PLACEMENTS) {
      expect(skus).toContain(placement.gpu_type);
    }
  });

  it('should include both mlperf and mmlu benchmark kinds', () => {
    const kinds = new Set(cells.map((c) => c.kind));
    expect(kinds).toContain(GpuSweepCellKind.MLPERF);
    expect(kinds).toContain(GpuSweepCellKind.MMLU);
  });

  it('DEDUP_KEYS should all be absent from the materialized matrix', () => {
    const keySet = new Set(cells.map((c) => c.cell_key));
    for (const dedupKey of DEDUP_KEYS) {
      expect(keySet.has(dedupKey)).toBe(false);
    }
  });

  it('DEDUP_KEYS should contain exactly 20 entries', () => {
    expect(DEDUP_KEYS).toHaveLength(20);
  });

  it('fp8 bs=4 cells should not appear on A40 SKUs', () => {
    const illegal = cells.filter(
      (c) =>
        c.gpu_type.startsWith('NVIDIA-A40') &&
        c.precision === 'fp8' &&
        c.batch_size === 4,
    );
    expect(illegal).toHaveLength(0);
  });

  it('TP=2 cells should only appear on L40 and L40-44GiB nodes', () => {
    const tp2 = cells.filter((c) => c.tensor_parallel_size === 2);
    const illegal = tp2.filter(
      (c) => !['NVIDIA-L40', 'NVIDIA-L40-44GiB'].includes(c.gpu_type),
    );
    expect(illegal).toHaveLength(0);
  });

  it('mlperf server scenario should not appear for data_number < 500', () => {
    const illegal = cells.filter(
      (c) =>
        c.kind === GpuSweepCellKind.MLPERF &&
        c.scenario === 'server' &&
        c.data_number < 500,
    );
    expect(illegal).toHaveLength(0);
  });

  it('mlperf server scenario should not appear with batch_size > 1', () => {
    const illegal = cells.filter(
      (c) =>
        c.kind === GpuSweepCellKind.MLPERF &&
        c.scenario === 'server' &&
        c.batch_size > 1,
    );
    expect(illegal).toHaveLength(0);
  });

  it('mmlu 25/subj on bf16 should be absent', () => {
    const illegal = cells.filter(
      (c) =>
        c.kind === GpuSweepCellKind.MMLU &&
        c.data_number === 25 &&
        c.precision === 'bf16',
    );
    expect(illegal).toHaveLength(0);
  });

  it('all cells should have retry_num = 3', () => {
    const bad = cells.filter((c) => c.retry_num !== 3);
    expect(bad).toHaveLength(0);
  });

  it('cells should be assigned to node2 or node3 only', () => {
    const badNodes = cells.filter(
      (c) => c.node !== 'node2' && c.node !== 'node3',
    );
    expect(badNodes).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Calibration subset (used by POST /api/gpu-sweep/start { mode: calibration })
  // -------------------------------------------------------------------------

  describe('calibration subset', () => {
    it('should find exactly 2 canonical cells matching CANONICAL_CELL spec', () => {
      const calibCells = cells.filter(
        (c) =>
          c.kind === GpuSweepCellKind.MLPERF &&
          c.precision === 'fp8' &&
          c.batch_size === 1 &&
          c.data_number === 500 &&
          c.tensor_parallel_size === 1 &&
          c.scenario === 'offline' &&
          ['NVIDIA-L40', 'NVIDIA-L40-44GiB'].includes(c.gpu_type),
      );
      expect(calibCells).toHaveLength(2);
      const nodes = calibCells.map((c) => c.node);
      expect(nodes).toContain('node2');
      expect(nodes).toContain('node3');
    });
  });

  // -------------------------------------------------------------------------
  // Timeline
  // -------------------------------------------------------------------------

  describe('buildTimeline', () => {
    it('should build a timeline with entries for both nodes', () => {
      const timeline = buildTimeline(cells);
      expect(timeline.node2.length).toBeGreaterThan(0);
      expect(timeline.node3.length).toBeGreaterThan(0);
    });

    it('scheduled_offset_seconds should be monotonically non-decreasing per node', () => {
      const timeline = buildTimeline(cells);
      for (const nodeEntries of [timeline.node2, timeline.node3]) {
        for (let i = 1; i < nodeEntries.length; i++) {
          expect(nodeEntries[i].scheduled_offset_seconds).toBeGreaterThan(
            nodeEntries[i - 1].scheduled_offset_seconds,
          );
        }
      }
    });

    it('each timeline entry should include estimated_duration_seconds > 0', () => {
      const timeline = buildTimeline(cells);
      for (const entry of [...timeline.node2, ...timeline.node3]) {
        expect(entry.estimated_duration_seconds).toBeGreaterThan(0);
      }
    });

    it('consecutive same-node offsets should differ by at least 60s (stagger)', () => {
      const timeline = buildTimeline(cells);
      for (const nodeEntries of [timeline.node2, timeline.node3]) {
        for (let i = 1; i < nodeEntries.length; i++) {
          const gap =
            nodeEntries[i].scheduled_offset_seconds -
            nodeEntries[i - 1].scheduled_offset_seconds -
            nodeEntries[i - 1].estimated_duration_seconds;
          // Allow 0.1s float tolerance
          expect(gap).toBeGreaterThanOrEqual(59.9);
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // Matrix filtering options
  // -------------------------------------------------------------------------

  describe('expandMatrix with options', () => {
    it('gpu_skus filter should return only cells for the specified SKU', () => {
      const filtered = expandMatrix({ gpu_skus: ['NVIDIA-L40'] });
      const skus = new Set(filtered.map((c) => c.gpu_type));
      expect(skus.size).toBe(1);
      expect(skus).toContain('NVIDIA-L40');
    });

    it('benchmarks filter should return only mlperf cells', () => {
      const filtered = expandMatrix({ benchmarks: ['mlperf'] });
      const kinds = new Set(filtered.map((c) => c.kind));
      expect(kinds.size).toBe(1);
      expect(kinds).toContain(GpuSweepCellKind.MLPERF);
    });

    it('precisions filter should return only fp8 cells', () => {
      const filtered = expandMatrix({ precisions: ['fp8'] });
      const precs = new Set(filtered.map((c) => c.precision));
      expect(precs.size).toBe(1);
      expect(precs).toContain('fp8');
    });
  });
});
