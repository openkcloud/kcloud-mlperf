// WS-E: NPU dispatch path coverage. Asserts that the canonical sweep matrix
// includes node4 (Furiosa RNGD) + node5 (Rebellions ATOM) cells with the
// live-cluster-correct allocatable resource keys:
//   node4 → furiosa.ai/rngd: 1
//   node5 → rebellions.ai/ATOM: 1
// (Verified 2026-05-11 against `kubectl get node node{4,5} -o jsonpath`.)
//
// These tests exist alongside matrix.fixture.spec.ts which locks the GPU side.
// The mutex-coverage assertion below is the ts-morph/grep guard required by
// WS-E acceptance criterion (6): NO duplicate mutex Record was introduced —
// the existing per-node mutex Record was extended to cover all 4 worker nodes.
import { readFileSync } from 'fs';
import { join } from 'path';
import { expandMatrix, NPU_PLACEMENTS } from './matrix';
import { GpuSweepCellKind } from './entities/gpu-sweep-cell.entity';

describe('NPU matrix extension (WS-E)', () => {
  const cells = expandMatrix();

  it('includes at least one node4 cell using the Furiosa RNGD NPU', () => {
    const node4 = cells.filter((c) => c.node === 'node4');
    expect(node4.length).toBeGreaterThan(0);
    for (const c of node4) {
      expect(c.gpu_type).toBe('RNGD');
      expect(c.npu_resource).toBe('furiosa.ai/rngd');
      expect(c.vendor).toBe('furiosa');
    }
  });

  it('includes at least one node5 cell using the Rebellions ATOM NPU', () => {
    const node5 = cells.filter((c) => c.node === 'node5');
    expect(node5.length).toBeGreaterThan(0);
    for (const c of node5) {
      expect(c.gpu_type).toBe('Atom+');
      expect(c.npu_resource).toBe('rebellions.ai/ATOM');
      expect(c.vendor).toBe('rebellions');
    }
  });

  it('NPU placements catalog covers exactly node4 + node5', () => {
    const nodes = NPU_PLACEMENTS.map((p) => p.node).sort();
    expect(nodes).toEqual(['node4', 'node5']);
  });

  it('NPU cells use offline scenario (no server@1qps for NPUs in v1)', () => {
    const npuCells = cells.filter(
      (c) => c.node === 'node4' || c.node === 'node5',
    );
    for (const c of npuCells) {
      expect(c.scenario).toBe('offline');
    }
  });

  it('NPU cells include both mlperf and mmlu kinds', () => {
    const npuCells = cells.filter(
      (c) => c.node === 'node4' || c.node === 'node5',
    );
    const kinds = new Set(npuCells.map((c) => c.kind));
    expect(kinds.has(GpuSweepCellKind.MLPERF)).toBe(true);
    expect(kinds.has(GpuSweepCellKind.MMLU)).toBe(true);
  });

  // ------------------------------------------------------------------------
  // Acceptance criterion (6): NO duplicate mutex Record was introduced.
  // The existing nodeMutex Record was extended in place. Static check:
  // gpu-sweep.service.ts contains exactly ONE `nodeMutex:` declaration and
  // exactly ONE `nodeQueue:` declaration. (grep-style guard against drift.)
  // ------------------------------------------------------------------------
  it('gpu-sweep.service.ts has exactly one nodeMutex + one nodeQueue declaration', () => {
    const src = readFileSync(join(__dirname, 'gpu-sweep.service.ts'), 'utf8');
    const mutexDecls = src.match(/private\s+readonly\s+nodeMutex\b/g) ?? [];
    const queueDecls = src.match(/private\s+readonly\s+nodeQueue\b/g) ?? [];
    expect(mutexDecls).toHaveLength(1);
    expect(queueDecls).toHaveLength(1);
  });
});
