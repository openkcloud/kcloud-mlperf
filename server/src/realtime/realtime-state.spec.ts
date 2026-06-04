/**
 * Unit tests for the realtime slot state machine:
 *  - stale TTL (running → stale when heartbeat >2 min old)
 *  - missing hardware → idle (no cross-vendor leakage)
 *  - impossible state guard (status field always a valid SlotState)
 *  - vendor cross-leakage (RNGD exam must not appear on Atom+ slot)
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RealtimeService, GPU_SWEEP_SERVICE_TOKEN } from './realtime.service';
import { MpExam } from '../entities/mp-exam.entity';
import { MmExam } from '../entities/mm-exam.entity';
import { MpExamResult } from '../entities/mp-exam-result.entity';
import { NpuExam } from '../entities/npu-exam.entity';
import { NpuExamResult } from '../entities/npu-exam-result.entity';
import { DeviceRegistryService } from '../device-registry/device-registry.service';
import { DeviceTelemetryService } from './device-telemetry.service';
import { StatusEnum } from '../enums/status.enum';
import type { DeviceEntry } from '../device-registry/device-registry.types';

const VALID_SLOT_STATES = new Set([
  'idle',
  'queued',
  'running',
  'preparing',
  'completed',
  'failed',
  'stale',
  'unavailable',
  'unknown',
  'error',
  'pending_join',
]);

const mockRepo = () => ({
  find: jest.fn().mockResolvedValue([]),
  createQueryBuilder: jest.fn(() => ({
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
  })),
});

const RNGD_DEVICE: DeviceEntry = {
  node: 'node4',
  type: 'npu',
  vendor: 'furiosa',
  model: 'RNGD',
  slot_id: 0,
  state: 'ready',
  k8s_node_status: 'Ready',
  allocatable_resource_name: 'furiosa.ai/npu',
  allocatable_count: 1,
  source: 'cluster_yaml',
};

const ATOM_DEVICE: DeviceEntry = {
  node: 'node5',
  type: 'npu',
  vendor: 'rebellions',
  model: 'ATOM',
  slot_id: 0,
  state: 'ready',
  k8s_node_status: 'Ready',
  allocatable_resource_name: 'rebellions.ai/ATOM',
  allocatable_count: 1,
  source: 'cluster_yaml',
};

async function buildModule(
  devices: DeviceEntry[],
  npuExams: Partial<NpuExam>[] = [],
  npuResults: Partial<NpuExamResult>[] = [],
) {
  const npuExamRepo = {
    find: jest.fn().mockResolvedValue(npuExams),
    createQueryBuilder: jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    })),
  };
  const npuResultRepo = {
    find: jest.fn().mockResolvedValue([]),
    createQueryBuilder: jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(npuResults),
    })),
  };
  const deviceRegistry = {
    getDevices: jest.fn().mockResolvedValue(devices),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      RealtimeService,
      { provide: getRepositoryToken(MpExam), useValue: mockRepo() },
      { provide: getRepositoryToken(MmExam), useValue: mockRepo() },
      { provide: getRepositoryToken(MpExamResult), useValue: mockRepo() },
      { provide: getRepositoryToken(NpuExam), useValue: npuExamRepo },
      { provide: getRepositoryToken(NpuExamResult), useValue: npuResultRepo },
      { provide: GPU_SWEEP_SERVICE_TOKEN, useValue: null },
      { provide: DeviceRegistryService, useValue: deviceRegistry },
      {
        provide: DeviceTelemetryService,
        useValue: {
          getGpuTelemetry: jest.fn().mockResolvedValue(null),
          getNpuTelemetry: jest.fn().mockResolvedValue(null),
          getVllmTelemetry: jest.fn().mockResolvedValue(null),
        },
      },
    ],
  }).compile();

  return module.get<RealtimeService>(RealtimeService);
}

// ---------------------------------------------------------------------------

describe('Realtime slot state machine', () => {
  describe('stale TTL', () => {
    it('marks RNGD slot as RUNNING when started_at >2 min ago and no result yet (pre-first-heartbeat grace)', async () => {
      // Contract change 2026-05-18: while waiting for the first heartbeat,
      // the slot stays "running" for up to NEVER_HEARTBEAT_THRESHOLD_MS
      // (30 min). Full-MLPerf model load takes several minutes; flipping to
      // "stale" at 2 min mislabels healthy warmup as broken on the dashboard.
      const recentStartedAt = new Date(Date.now() - 3 * 60 * 1000).toISOString();
      const npuExam: Partial<NpuExam> = {
        id: 1,
        name: 'rngd-bench',
        npu_type: 'RNGD',
        status: StatusEnum.RUNNING,
        started_at: recentStartedAt,
      };

      const svc = await buildModule([RNGD_DEVICE], [npuExam], []);
      const snap = await svc.buildSnapshot();
      const rngd = snap.slots.find((s) => s.model === 'RNGD');

      expect(rngd).toBeDefined();
      expect(rngd!.status).toBe('running');
      expect(rngd!.last_seen).toBeNull();
    });

    it('marks RNGD slot as stale when started_at >30 min ago and STILL no result (true silent worker)', async () => {
      const staleStartedAt = new Date(Date.now() - 31 * 60 * 1000).toISOString();
      const npuExam: Partial<NpuExam> = {
        id: 99,
        name: 'rngd-silent',
        npu_type: 'RNGD',
        status: StatusEnum.RUNNING,
        started_at: staleStartedAt,
      };
      const svc = await buildModule([RNGD_DEVICE], [npuExam], []);
      const snap = await svc.buildSnapshot();
      const rngd = snap.slots.find((s) => s.model === 'RNGD');
      expect(rngd!.status).toBe('stale');
    });

    it('picks the most-recently-started RNGD exam, not the oldest, when multiple "Running" rows exist (orphaned by power outage)', async () => {
      // Regression for 2026-05-18 audit: power outage left exams #155, #156
      // pinned as Running for days. The realtime matcher used .find() which
      // returned the first match (oldest id), so the dashboard hid the
      // currently-active sweep behind a multi-day-old row.
      const ancient: Partial<NpuExam> = {
        id: 155,
        name: 'rngd-orphan-from-outage',
        npu_type: 'RNGD',
        status: StatusEnum.RUNNING,
        started_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      };
      const fresh: Partial<NpuExam> = {
        id: 159,
        name: 'rngd-current-sweep',
        npu_type: 'RNGD',
        status: StatusEnum.RUNNING,
        started_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      };
      // Intentionally put the ancient one first to defeat any .find()-style
      // matcher that returns the first match.
      const svc = await buildModule([RNGD_DEVICE], [ancient, fresh], []);
      const snap = await svc.buildSnapshot();
      const rngd = snap.slots.find((s) => s.model === 'RNGD');
      expect(rngd!.current_exam?.id).toBe(159);
    });

    it('marks RNGD slot as running when last metric is <2 min old', async () => {
      const recentStartedAt = new Date(Date.now() - 30_000).toISOString();
      const npuExam: Partial<NpuExam> = {
        id: 2,
        name: 'rngd-bench',
        npu_type: 'RNGD',
        status: StatusEnum.RUNNING,
        started_at: recentStartedAt,
      };
      const npuResult: Partial<NpuExamResult> = {
        id: 10,
        exam_id: 2,
        result_tps: 55.1,
        result_tt100t: 1.2,
        created_at: new Date(),
      };

      const svc = await buildModule([RNGD_DEVICE], [npuExam], [npuResult]);
      const snap = await svc.buildSnapshot();
      const rngd = snap.slots.find((s) => s.model === 'RNGD');

      expect(rngd!.status).toBe('running');
      expect(rngd!.last_seen).not.toBeNull();
    });

    it('marks slot as stale when last result heartbeat is >2 min old even if started_at is recent', async () => {
      const npuExam: Partial<NpuExam> = {
        id: 3,
        name: 'rngd-bench',
        npu_type: 'RNGD',
        status: StatusEnum.RUNNING,
        started_at: new Date(Date.now() - 10_000).toISOString(),
      };
      // last result was emitted 3 minutes ago — zombie heartbeat
      const staleResult: Partial<NpuExamResult> = {
        id: 11,
        exam_id: 3,
        result_tps: 42.0,
        result_tt100t: 1.5,
        created_at: new Date(Date.now() - 3 * 60 * 1000),
      };

      const svc = await buildModule([RNGD_DEVICE], [npuExam], [staleResult]);
      const snap = await svc.buildSnapshot();
      const rngd = snap.slots.find((s) => s.model === 'RNGD');

      expect(rngd!.status).toBe('stale');
      expect(rngd!.last_seen).not.toBeNull();
    });
  });

  describe('missing hardware / idle', () => {
    it('returns idle when no active exam for the device', async () => {
      const svc = await buildModule([RNGD_DEVICE], [], []);
      const snap = await svc.buildSnapshot();
      const rngd = snap.slots.find((s) => s.model === 'RNGD');

      expect(rngd!.status).toBe('idle');
      expect(rngd!.current_exam).toBeNull();
      expect(rngd!.last_seen).toBeNull();
    });
  });

  describe('impossible state guard', () => {
    it('every slot status is a valid SlotState value', async () => {
      const runningExam: Partial<NpuExam> = {
        id: 4,
        name: 'guard-test',
        npu_type: 'RNGD',
        status: StatusEnum.RUNNING,
        started_at: new Date(Date.now() - 10_000).toISOString(),
      };

      const svc = await buildModule(
        [RNGD_DEVICE, ATOM_DEVICE],
        [runningExam],
        [],
      );
      const snap = await svc.buildSnapshot();

      for (const slot of snap.slots) {
        expect(VALID_SLOT_STATES).toContain(slot.status);
      }
    });
  });

  describe('vendor cross-leakage', () => {
    it('RNGD exam does NOT appear on Atom+ slot', async () => {
      const rngdExam: Partial<NpuExam> = {
        id: 5,
        name: 'rngd-only',
        npu_type: 'RNGD',
        status: StatusEnum.RUNNING,
        started_at: new Date(Date.now() - 10_000).toISOString(),
      };

      const svc = await buildModule([RNGD_DEVICE, ATOM_DEVICE], [rngdExam], []);
      const snap = await svc.buildSnapshot();

      const rngd = snap.slots.find((s) => s.model === 'RNGD');
      const atom = snap.slots.find((s) => s.model === 'ATOM');

      // RNGD slot should be running (started <2 min ago, no results yet = stale
      // because no heartbeat — but the point is ATOM must be idle)
      expect(atom!.status).toBe('idle');
      expect(atom!.current_exam).toBeNull();
      // RNGD slot carries the exam (stale since no result row within 2 min)
      expect(rngd!.current_exam?.id).toBe(5);
    });

    it('Atom+ exam does NOT appear on RNGD slot', async () => {
      const atomExam: Partial<NpuExam> = {
        id: 6,
        name: 'atom-only',
        npu_type: 'ATOM',
        status: StatusEnum.RUNNING,
        started_at: new Date(Date.now() - 10_000).toISOString(),
      };

      const svc = await buildModule([RNGD_DEVICE, ATOM_DEVICE], [atomExam], []);
      const snap = await svc.buildSnapshot();

      const rngd = snap.slots.find((s) => s.model === 'RNGD');
      const atom = snap.slots.find((s) => s.model === 'ATOM');

      expect(rngd!.status).toBe('idle');
      expect(rngd!.current_exam).toBeNull();
      expect(atom!.current_exam?.id).toBe(6);
    });

    it('RNGD exam with lowercase npu_type still maps to RNGD slot', async () => {
      const rngdExam: Partial<NpuExam> = {
        id: 7,
        name: 'rngd-lower',
        npu_type: 'rngd',
        status: StatusEnum.RUNNING,
        started_at: new Date(Date.now() - 10_000).toISOString(),
      };

      const svc = await buildModule([RNGD_DEVICE], [rngdExam], []);
      const snap = await svc.buildSnapshot();

      const rngd = snap.slots.find((s) => s.model === 'RNGD');
      expect(rngd!.current_exam?.id).toBe(7);
    });
  });
});
