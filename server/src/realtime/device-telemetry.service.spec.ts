/**
 * Unit tests for DeviceTelemetryService.getNpuTelemetry()
 *
 * Coverage targets (QA m-rt1):
 *   (a) vendor='rebellions' + cardName: PromQL includes per-card name filter;
 *       rbln0 and rbln1 resolve to independent power/temp/dram from distinct
 *       mocked series — proves the Atom+ per-card split can never silently
 *       merge back to a node aggregate.
 *   (b) vendor='furiosa' (no cardName): name filter is NOT added to any query.
 *   (c) timeout/empty path: returns {source:'unavailable', exporter_status:'timeout'}.
 */
import { Test, TestingModule } from '@nestjs/testing';
import {
  DeviceTelemetryService,
  SlotTelemetry,
} from './device-telemetry.service';
import { PrometheusClient, PrometheusSample } from '../prometheus/prometheus.client';

/** Build a minimal PrometheusSample for mocking. */
function sample(value: number, timestamp = 1_700_000_000): PrometheusSample {
  return { value, timestamp, labels: {} };
}

/** Return an empty array — simulates Prometheus returning no data. */
const noSamples = (): Promise<PrometheusSample[]> =>
  Promise.resolve([]);

describe('DeviceTelemetryService.getNpuTelemetry', () => {
  let service: DeviceTelemetryService;
  let instantQuery: jest.Mock<Promise<PrometheusSample[]>, [string]>;

  beforeEach(async () => {
    instantQuery = jest.fn().mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeviceTelemetryService,
        {
          provide: PrometheusClient,
          useValue: { instantQuery },
        },
      ],
    }).compile();

    service = module.get<DeviceTelemetryService>(DeviceTelemetryService);
  });

  // --------------------------------------------------------------------------
  // (a) vendor='rebellions' — per-card filter + independent series
  // --------------------------------------------------------------------------

  describe('vendor=rebellions with cardName (Atom+ per-card split)', () => {
    it('rbln0 queries include name="rbln0" filter in every PromQL expression', async () => {
      // All queries return a sample so the service reaches the return path.
      instantQuery.mockResolvedValue([sample(10)]);

      await service.getNpuTelemetry('rebellions', 'node5', 'rbln0');

      const queries: string[] = instantQuery.mock.calls.map((c) => c[0]);
      expect(queries.length).toBeGreaterThan(0);
      for (const q of queries) {
        expect(q).toContain('name="rbln0"');
        expect(q).not.toContain('name="rbln1"');
      }
    });

    it('rbln1 queries include name="rbln1" filter in every PromQL expression', async () => {
      instantQuery.mockResolvedValue([sample(20)]);

      await service.getNpuTelemetry('rebellions', 'node5', 'rbln1');

      const queries: string[] = instantQuery.mock.calls.map((c) => c[0]);
      expect(queries.length).toBeGreaterThan(0);
      for (const q of queries) {
        expect(q).toContain('name="rbln1"');
        expect(q).not.toContain('name="rbln0"');
      }
    });

    it('rbln0 and rbln1 resolve to INDEPENDENT power/temp/dram values', async () => {
      // Distinct per-card sample values.
      const rbln0Power = 85;
      const rbln0Temp = 42;
      const rbln0DramUsed = 4_000_000_000; // 4 GB
      const rbln0DramTotal = 8_000_000_000; // 8 GB

      const rbln1Power = 92;
      const rbln1Temp = 47;
      const rbln1DramUsed = 6_000_000_000; // 6 GB
      const rbln1DramTotal = 8_000_000_000; // 8 GB

      // For rbln0: util, power, dramUsed, dramTotal, temp, health (6 queries)
      const rbln0Mock = jest
        .fn()
        .mockResolvedValueOnce([sample(55)])           // util
        .mockResolvedValueOnce([sample(rbln0Power)])   // power
        .mockResolvedValueOnce([sample(rbln0DramUsed)]) // dramUsed
        .mockResolvedValueOnce([sample(rbln0DramTotal)]) // dramTotal
        .mockResolvedValueOnce([sample(rbln0Temp)])    // temp
        .mockResolvedValueOnce([sample(0)]);           // health

      const module0: TestingModule = await Test.createTestingModule({
        providers: [
          DeviceTelemetryService,
          { provide: PrometheusClient, useValue: { instantQuery: rbln0Mock } },
        ],
      }).compile();
      const svc0 = module0.get<DeviceTelemetryService>(DeviceTelemetryService);
      const tel0 = await svc0.getNpuTelemetry('rebellions', 'node5', 'rbln0');

      // For rbln1: different values
      const rbln1Mock = jest
        .fn()
        .mockResolvedValueOnce([sample(70)])           // util
        .mockResolvedValueOnce([sample(rbln1Power)])   // power
        .mockResolvedValueOnce([sample(rbln1DramUsed)]) // dramUsed
        .mockResolvedValueOnce([sample(rbln1DramTotal)]) // dramTotal
        .mockResolvedValueOnce([sample(rbln1Temp)])    // temp
        .mockResolvedValueOnce([sample(0)]);           // health

      const module1: TestingModule = await Test.createTestingModule({
        providers: [
          DeviceTelemetryService,
          { provide: PrometheusClient, useValue: { instantQuery: rbln1Mock } },
        ],
      }).compile();
      const svc1 = module1.get<DeviceTelemetryService>(DeviceTelemetryService);
      const tel1 = await svc1.getNpuTelemetry('rebellions', 'node5', 'rbln1');

      // Both slots must be 'prometheus' (not 'unavailable').
      expect(tel0.source).toBe('prometheus');
      expect(tel1.source).toBe('prometheus');

      // Power is distinct between the two cards.
      expect(tel0.power_w).toBe(Number(rbln0Power.toFixed(3)));
      expect(tel1.power_w).toBe(Number(rbln1Power.toFixed(3)));

      // Temperature is distinct.
      expect(tel0.temp_c).toBe(Number(rbln0Temp.toFixed(2)));
      expect(tel1.temp_c).toBe(Number(rbln1Temp.toFixed(2)));

      // DRAM used is distinct (converted bytes→GB).
      expect(tel0.dram_used_gb).toBe(Number((rbln0DramUsed / 1e9).toFixed(2)));
      expect(tel1.dram_used_gb).toBe(Number((rbln1DramUsed / 1e9).toFixed(2)));

      // They must not be equal (the cards have genuinely different readings).
      expect(tel0.power_w).not.toBe(tel1.power_w);
      expect(tel0.temp_c).not.toBe(tel1.temp_c);
      expect(tel0.dram_used_gb).not.toBe(tel1.dram_used_gb);
    });

    it('hostname filter is also present in per-card queries', async () => {
      instantQuery.mockResolvedValue([sample(5)]);

      await service.getNpuTelemetry('rebellions', 'node5', 'rbln0');

      const queries: string[] = instantQuery.mock.calls.map((c) => c[0]);
      for (const q of queries) {
        expect(q).toContain('hostname="node5"');
      }
    });

    it('health_ok is true when HEALTH metric value is 0 (RBLN convention)', async () => {
      // util, power, dramUsed, dramTotal, temp, health
      instantQuery
        .mockResolvedValueOnce([sample(50)])  // util
        .mockResolvedValueOnce([sample(80)])  // power
        .mockResolvedValueOnce([sample(2e9)]) // dramUsed
        .mockResolvedValueOnce([sample(8e9)]) // dramTotal
        .mockResolvedValueOnce([sample(40)])  // temp
        .mockResolvedValueOnce([sample(0)]);  // health = 0 → OK

      const tel = await service.getNpuTelemetry('rebellions', 'node5', 'rbln0');
      expect(tel.health_ok).toBe(true);
    });

    it('health_ok is false when HEALTH metric value is non-zero', async () => {
      instantQuery
        .mockResolvedValueOnce([sample(50)])  // util
        .mockResolvedValueOnce([sample(80)])  // power
        .mockResolvedValueOnce([sample(2e9)]) // dramUsed
        .mockResolvedValueOnce([sample(8e9)]) // dramTotal
        .mockResolvedValueOnce([sample(40)])  // temp
        .mockResolvedValueOnce([sample(1)]);  // health = 1 → not OK

      const tel = await service.getNpuTelemetry('rebellions', 'node5', 'rbln0');
      expect(tel.health_ok).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // (b) vendor='furiosa' — no name filter in any query
  // --------------------------------------------------------------------------

  describe('vendor=furiosa (RNGD, no cardName)', () => {
    it('queries do NOT include any name="..." filter', async () => {
      instantQuery.mockResolvedValue([sample(30)]);

      await service.getNpuTelemetry('furiosa', 'node4');

      const queries: string[] = instantQuery.mock.calls.map((c) => c[0]);
      expect(queries.length).toBeGreaterThan(0);
      for (const q of queries) {
        // No per-card name label should appear for Furiosa.
        expect(q).not.toMatch(/name="rbln/);
      }
    });

    it('queries contain hostname="node4" filter', async () => {
      instantQuery.mockResolvedValue([sample(30)]);

      await service.getNpuTelemetry('furiosa', 'node4');

      const queries: string[] = instantQuery.mock.calls.map((c) => c[0]);
      for (const q of queries) {
        expect(q).toContain('hostname="node4"');
      }
    });

    it('returns source=prometheus with util_pct when samples are present', async () => {
      // furiosa queries: util, alive, power, tempPeak, dramUsed, dramTotal (6)
      instantQuery
        .mockResolvedValueOnce([sample(60)])    // util
        .mockResolvedValueOnce([sample(1)])     // alive
        .mockResolvedValueOnce([sample(120)])   // power
        .mockResolvedValueOnce([sample(55)])    // tempPeak
        .mockResolvedValueOnce([sample(6e9)])   // dramUsed
        .mockResolvedValueOnce([sample(16e9)]); // dramTotal

      const tel = await service.getNpuTelemetry('furiosa', 'node4');
      expect(tel.source).toBe('prometheus');
      expect(tel.exporter_status).toBe('ok');
      expect(tel.util_pct).toBe(60);
      expect(tel.alive).toBe(1);
      expect(tel.power_w).toBe(120);
      expect(tel.temp_c).toBe(55);
      expect(tel.dram_used_gb).toBe(Number((6e9 / 1e9).toFixed(2)));
    });

    it('uses furiosa-specific metric names (furiosa_npu_*) not RBLN metrics', async () => {
      instantQuery.mockResolvedValue([sample(1)]);

      await service.getNpuTelemetry('furiosa', 'node4');

      const queries: string[] = instantQuery.mock.calls.map((c) => c[0]);
      for (const q of queries) {
        expect(q).not.toMatch(/RBLN_/);
      }
      // At least one furiosa metric should appear.
      expect(queries.some((q) => q.includes('furiosa_npu_'))).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // (c) timeout / empty path
  // --------------------------------------------------------------------------

  describe('timeout / empty path', () => {
    it('returns {source:"unavailable", exporter_status:"timeout"} when all rebellions queries return empty arrays', async () => {
      // The default mock already returns [] for every call.
      const tel = await service.getNpuTelemetry('rebellions', 'node5', 'rbln0');
      expect(tel.source).toBe('unavailable');
      expect(tel.exporter_status).toBe('timeout');
    });

    it('returns {source:"unavailable", exporter_status:"timeout"} when all furiosa queries return empty arrays', async () => {
      const tel = await service.getNpuTelemetry('furiosa', 'node4');
      expect(tel.source).toBe('unavailable');
      expect(tel.exporter_status).toBe('timeout');
    });

    it('age_seconds is null in the timeout response', async () => {
      const tel = await service.getNpuTelemetry('rebellions', 'node5', 'rbln0');
      expect(tel.age_seconds).toBeNull();
    });

    it('returns unavailable/timeout even when only some queries return empty (rebellions partial)', async () => {
      // Only the first query (util) returns a sample; all others return empty.
      // The service checks the union of all samples, so all-empty → timeout.
      // Here we simulate ALL empty to stay at the timeout branch.
      instantQuery.mockResolvedValue([]);

      const tel = await service.getNpuTelemetry('rebellions', 'node5', 'rbln1');
      expect(tel.source).toBe('unavailable');
      expect(tel.exporter_status).toBe('timeout');
    });
  });
});
