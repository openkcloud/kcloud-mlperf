import { Injectable, Logger } from '@nestjs/common';
import { PrometheusClient } from './prometheus.client';

/**
 * R8 (perf/Watt): best-effort capture of the mean device power over a run's
 * window, evaluated at the run's end. Reuses the SAME metric/label
 * expressions as device-telemetry.service.ts:
 *   - GPU (nvidia)   : DCGM_FI_DEV_POWER_USAGE{Hostname="<node>"}
 *   - furiosa (RNGD) : furiosa_npu_hw_power{hostname="<node>", label="rms"}
 *   - rebellions     : RBLN_DEVICE_STATUS:CARD_POWER{hostname="<node>"}
 *
 * The exam row only carries the node name (not a per-card DCGM `gpu` slot),
 * so for GPU we collapse all cards on the node with avg(); furiosa already
 * scopes to the rms-label scalar and rebellions sums per-card power. We wrap
 * the selector in avg_over_time([window]) (see PrometheusClient) so the value
 * is the mean across the run window.
 *
 * Every method is non-throwing: on any failure (Prometheus down, no node,
 * empty result) it returns null so the caller can leave avg_power_w NULL
 * without ever blocking or failing the result write.
 */
@Injectable()
export class PowerCaptureService {
  private readonly logger = new Logger(PowerCaptureService.name);

  constructor(private readonly prom: PrometheusClient) {}

  /**
   * @param vendor  device vendor — selects the power metric/label expression.
   * @param node    k8s node name (DCGM `Hostname` / exporter `hostname`).
   * @param startedAt run start timestamp (ISO string or ms epoch parseable).
   * @param endAt   run end timestamp.
   * @returns mean power in Watts over [start..end], or null on any failure.
   */
  async captureAvgPower(
    vendor: 'nvidia' | 'furiosa' | 'rebellions' | string,
    node: string | null | undefined,
    startedAt: string | null | undefined,
    endAt: string | null | undefined,
  ): Promise<number | null> {
    try {
      if (!node) return null;
      const start = startedAt ? Date.parse(startedAt) : NaN;
      const end = endAt ? Date.parse(endAt) : NaN;
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return null;
      }
      const windowSeconds = (end - start) / 1000;
      const atTime = end / 1000; // evaluate ending at the run's end_at

      const metric = this.powerMetricForVendor(vendor, node);
      if (!metric) return null;

      const samples = await this.prom.avgOverTimeQuery(
        metric,
        windowSeconds,
        atTime,
      );

      // Average across any returned series (avg() in PromQL already collapses
      // for the wrapped forms below, but guard the multi-series case anyway).
      const values = samples
        .map((s) => s.value)
        .filter((v): v is number => v != null && Number.isFinite(v));
      if (values.length === 0) return null;
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      return Number.isFinite(mean) ? mean : null;
    } catch (err) {
      this.logger.warn(
        `captureAvgPower failed (vendor=${vendor} node=${node}): ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Build the bare series selector (no range vector) for the vendor's power
   * metric, scoped to the node. Returns null for unknown vendors.
   */
  private powerMetricForVendor(
    vendor: string,
    node: string,
  ): string | null {
    const v = (vendor || '').toLowerCase();
    if (v === 'nvidia') {
      // device-telemetry uses DCGM_FI_DEV_POWER_USAGE{Hostname,gpu}. The exam
      // row has no per-card slot, so avg across all cards on the host.
      return `avg(DCGM_FI_DEV_POWER_USAGE{Hostname="${node}"})`;
    }
    if (v === 'furiosa') {
      // device-telemetry: max(furiosa_npu_hw_power{hostname, label="rms"}).
      return `max(furiosa_npu_hw_power{hostname="${node}", label="rms"})`;
    }
    if (v === 'rebellions') {
      // device-telemetry: sum(RBLN_DEVICE_STATUS:CARD_POWER{hostname}).
      return `sum(RBLN_DEVICE_STATUS:CARD_POWER{hostname="${node}"})`;
    }
    return null;
  }
}
