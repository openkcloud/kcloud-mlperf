import { Injectable, Logger } from '@nestjs/common';
import { PrometheusClient } from '../prometheus/prometheus.client';

/**
 * Telemetry chunk attached to a RealtimeSlot. Every field is optional so the
 * frontend can render whatever is available without complaining about gaps.
 *
 *  - `source`           : where the data came from this tick.
 *  - `exporter_status`  : 'ok' when the metrics exporter reports samples;
 *                         'missing' / 'misconfigured' when we have no exporter
 *                         and want the UI to say so explicitly.
 *  - `age_seconds`      : (server time - newest prometheus scrape time). If
 *                         the value crosses ~60s the UI should treat it as
 *                         stale even though we still ship the last reading.
 */
export interface SlotTelemetry {
  source: 'prometheus' | 'unavailable';
  gpu_util_pct?: number | null;
  mem_copy_util_pct?: number | null;
  fb_used_mib?: number | null;
  fb_total_mib?: number | null;
  fb_free_mib?: number | null;
  power_w?: number | null;
  temp_c?: number | null;
  tokens_per_sec?: number | null;
  requests_running?: number | null;
  kv_cache_usage_pct?: number | null;
  exporter_status?: 'ok' | 'missing' | 'misconfigured' | 'timeout';
  age_seconds?: number | null;
  // NPU-specific fields (Furiosa + Rebellions). Optional so the UI doesn't
  // complain when only a subset of metrics is available.
  util_pct?: number | null;
  alive?: number | null;
  dram_used_gb?: number | null;
  dram_total_gb?: number | null;
  health_ok?: boolean | null;
}

/** Convert prometheus sample timestamp (seconds, float) to "age in seconds
 *  relative to now". Negative ages clamp to 0 to avoid clock-skew confusion. */
function ageSeconds(sampleTimestamp: number | null): number | null {
  if (sampleTimestamp == null) return null;
  const nowSec = Date.now() / 1000;
  const diff = nowSec - sampleTimestamp;
  return diff < 0 ? 0 : Number(diff.toFixed(1));
}

/** Return the freshest (max-ts) timestamp among the passed samples. */
function newestTimestamp(samples: Array<{ timestamp: number } | null>): number | null {
  let ts: number | null = null;
  for (const s of samples) {
    if (!s) continue;
    if (ts == null || s.timestamp > ts) ts = s.timestamp;
  }
  return ts;
}

@Injectable()
export class DeviceTelemetryService {
  private readonly logger = new Logger(DeviceTelemetryService.name);

  constructor(private readonly prom: PrometheusClient) {}

  /**
   * DCGM-backed GPU telemetry. Each query is filtered by Hostname + gpu to
   * pick exactly one card. Promise.allSettled is used by the caller so a
   * Prometheus timeout never bubbles up into the SSE response.
   */
  async getGpuTelemetry(node: string, slotIndex: number): Promise<SlotTelemetry> {
    // DCGM labels: Hostname="node2", gpu="0". slotIndex is the device-registry
    // slot_id (0|1) which lines up with the dcgm `gpu` label on these nodes.
    const labelFilter = `Hostname="${node}", gpu="${slotIndex}"`;

    const [util, fbUsed, fbFree, power, temp, memCopy] = await Promise.all([
      this.prom.instantQuery(`DCGM_FI_DEV_GPU_UTIL{${labelFilter}}`),
      this.prom.instantQuery(`DCGM_FI_DEV_FB_USED{${labelFilter}}`),
      this.prom.instantQuery(`DCGM_FI_DEV_FB_FREE{${labelFilter}}`),
      this.prom.instantQuery(`DCGM_FI_DEV_POWER_USAGE{${labelFilter}}`),
      this.prom.instantQuery(`DCGM_FI_DEV_GPU_TEMP{${labelFilter}}`),
      this.prom.instantQuery(`DCGM_FI_DEV_MEM_COPY_UTIL{${labelFilter}}`),
    ]);

    const utilSample = util[0] ?? null;
    const fbUsedSample = fbUsed[0] ?? null;
    const fbFreeSample = fbFree[0] ?? null;
    const powerSample = power[0] ?? null;
    const tempSample = temp[0] ?? null;
    const memCopySample = memCopy[0] ?? null;

    // No DCGM samples at all → exporter likely down for this hostname/gpu.
    const anySample =
      utilSample || fbUsedSample || fbFreeSample || powerSample || tempSample;
    if (!anySample) {
      return {
        source: 'unavailable',
        exporter_status: 'missing',
        age_seconds: null,
      };
    }

    const fb_used_mib = fbUsedSample?.value ?? null;
    const fb_free_mib = fbFreeSample?.value ?? null;
    const fb_total_mib =
      fb_used_mib != null && fb_free_mib != null
        ? fb_used_mib + fb_free_mib
        : null;

    const newestTs = newestTimestamp([
      utilSample,
      fbUsedSample,
      fbFreeSample,
      powerSample,
      tempSample,
      memCopySample,
    ]);

    return {
      source: 'prometheus',
      exporter_status: 'ok',
      gpu_util_pct: utilSample?.value ?? null,
      mem_copy_util_pct: memCopySample?.value ?? null,
      fb_used_mib,
      fb_free_mib,
      fb_total_mib,
      power_w: powerSample?.value ?? null,
      temp_c: tempSample?.value ?? null,
      age_seconds: ageSeconds(newestTs),
    };
  }

  /**
   * vLLM exporter — labels are by `model_name`. tokens-per-second is derived
   * from the rate() of the counter over the last minute; if no samples have
   * been scraped for that model we return an empty telemetry chunk and the
   * caller will mark the slot exporter_status="missing" itself.
   */
  async getVllmTelemetry(modelName: string): Promise<Partial<SlotTelemetry>> {
    const labelFilter = `model_name="${modelName}"`;

    const [rate, running, kv] = await Promise.all([
      this.prom.instantQuery(
        `rate(vllm:generation_tokens_total{${labelFilter}}[1m])`,
      ),
      this.prom.instantQuery(`vllm:num_requests_running{${labelFilter}}`),
      this.prom.instantQuery(`vllm:gpu_cache_usage_perc{${labelFilter}}`),
    ]);

    const rateSample = rate[0] ?? null;
    const runningSample = running[0] ?? null;
    const kvSample = kv[0] ?? null;

    if (!rateSample && !runningSample && !kvSample) {
      return {};
    }

    // gpu_cache_usage_perc from vllm is a fraction (0..1); surface as percent.
    const kvPct =
      kvSample?.value != null ? Number((kvSample.value * 100).toFixed(2)) : null;

    return {
      tokens_per_sec:
        rateSample?.value != null ? Number(rateSample.value.toFixed(2)) : null,
      requests_running: runningSample?.value ?? null,
      kv_cache_usage_pct: kvPct,
      age_seconds: ageSeconds(
        newestTimestamp([rateSample, runningSample, kvSample]),
      ),
    };
  }

  /**
   * NPU telemetry sourced from per-vendor Prometheus exporters:
   *   - furiosa: furiosa-metrics-exporter (`furiosa_npu_*` metrics, label
   *     `hostname=$node`, `core=0..7` or `core="0-7"` for hw_power/temp).
   *   - rebellions: rbln-metrics-exporter (`RBLN_DEVICE_STATUS:*` metrics,
   *     label `hostname=$node`, `name=rbln0|rbln1`).
   *
   * Aggregations follow the v38 spec:
   *   - util_pct = avg(util) across cores/cards
   *   - power_w  = sum (rebellions, per-card) or scalar (furiosa rms label)
   *   - dram_*   = sum across cards converted to GB
   *
   * Errors are swallowed and surfaced as exporter_status='timeout'.
   */
  async getNpuTelemetry(
    vendor: 'furiosa' | 'rebellions',
    node: string,
    cardName?: string,
  ): Promise<SlotTelemetry> {
    const hostFilter = `hostname="${node}"`;
    // Rebellions exposes one metric series per card (name="rbln0"|"rbln1"); when
    // a specific card is requested, narrow to it so each Atom+ slot reports its
    // own power/temp/util instead of the node aggregate. Furiosa (single RNGD
    // per node) ignores this.
    const rbFilter =
      cardName != null ? `${hostFilter}, name="${cardName}"` : hostFilter;

    if (vendor === 'furiosa') {
      const [util, alive, power, tempPeak, dramUsed, dramTotal] =
        await Promise.all([
          this.prom.instantQuery(
            `avg(furiosa_npu_core_utilization{${hostFilter}})`,
          ),
          this.prom.instantQuery(`max(furiosa_npu_alive{${hostFilter}})`),
          this.prom.instantQuery(
            `max(furiosa_npu_hw_power{${hostFilter}, label="rms"})`,
          ),
          this.prom.instantQuery(
            `max(furiosa_npu_hw_temperature{${hostFilter}, label="peak"})`,
          ),
          this.prom.instantQuery(`sum(furiosa_npu_dram_usage{${hostFilter}})`),
          this.prom.instantQuery(`sum(furiosa_npu_dram_total{${hostFilter}})`),
        ]);

      const utilSample = util[0] ?? null;
      const aliveSample = alive[0] ?? null;
      const powerSample = power[0] ?? null;
      const tempSample = tempPeak[0] ?? null;
      const dramUsedSample = dramUsed[0] ?? null;
      const dramTotalSample = dramTotal[0] ?? null;

      const anySample =
        utilSample ||
        aliveSample ||
        powerSample ||
        tempSample ||
        dramUsedSample ||
        dramTotalSample;
      if (!anySample) {
        return {
          source: 'unavailable',
          exporter_status: 'timeout',
          age_seconds: null,
        };
      }

      const dram_used_gb =
        dramUsedSample?.value != null
          ? Number((dramUsedSample.value / 1e9).toFixed(2))
          : null;
      const dram_total_gb =
        dramTotalSample?.value != null
          ? Number((dramTotalSample.value / 1e9).toFixed(2))
          : null;

      const newestTs = newestTimestamp([
        utilSample,
        aliveSample,
        powerSample,
        tempSample,
        dramUsedSample,
        dramTotalSample,
      ]);

      return {
        source: 'prometheus',
        exporter_status: 'ok',
        util_pct:
          utilSample?.value != null ? Number(utilSample.value.toFixed(2)) : null,
        alive: aliveSample?.value ?? null,
        power_w:
          powerSample?.value != null
            ? Number(powerSample.value.toFixed(2))
            : null,
        temp_c:
          tempSample?.value != null ? Number(tempSample.value.toFixed(2)) : null,
        dram_used_gb,
        dram_total_gb,
        age_seconds: ageSeconds(newestTs),
      };
    }

    // vendor === 'rebellions'
    const [util, power, dramUsed, dramTotal, temp, health] = await Promise.all([
      this.prom.instantQuery(
        `avg(RBLN_DEVICE_STATUS:UTILIZATION{${rbFilter}})`,
      ),
      this.prom.instantQuery(`sum(RBLN_DEVICE_STATUS:CARD_POWER{${rbFilter}})`),
      this.prom.instantQuery(`sum(RBLN_DEVICE_STATUS:DRAM_USED{${rbFilter}})`),
      this.prom.instantQuery(`sum(RBLN_DEVICE_STATUS:DRAM_TOTAL{${rbFilter}})`),
      this.prom.instantQuery(
        `avg(RBLN_DEVICE_STATUS:TEMPERATURE{${rbFilter}})`,
      ),
      this.prom.instantQuery(`max(RBLN_DEVICE_STATUS:HEALTH{${rbFilter}})`),
    ]);

    const utilSample = util[0] ?? null;
    const powerSample = power[0] ?? null;
    const dramUsedSample = dramUsed[0] ?? null;
    const dramTotalSample = dramTotal[0] ?? null;
    const tempSample = temp[0] ?? null;
    const healthSample = health[0] ?? null;

    const anySample =
      utilSample ||
      powerSample ||
      dramUsedSample ||
      dramTotalSample ||
      tempSample ||
      healthSample;
    if (!anySample) {
      return {
        source: 'unavailable',
        exporter_status: 'timeout',
        age_seconds: null,
      };
    }

    const dram_used_gb =
      dramUsedSample?.value != null
        ? Number((dramUsedSample.value / 1e9).toFixed(2))
        : null;
    const dram_total_gb =
      dramTotalSample?.value != null
        ? Number((dramTotalSample.value / 1e9).toFixed(2))
        : null;

    // HEALTH metric: 0 == OK per RBLN convention.
    const health_ok =
      healthSample?.value != null ? healthSample.value === 0 : null;

    const newestTs = newestTimestamp([
      utilSample,
      powerSample,
      dramUsedSample,
      dramTotalSample,
      tempSample,
      healthSample,
    ]);

    return {
      source: 'prometheus',
      exporter_status: 'ok',
      util_pct:
        utilSample?.value != null ? Number(utilSample.value.toFixed(2)) : null,
      power_w:
        powerSample?.value != null
          ? Number(powerSample.value.toFixed(3))
          : null,
      dram_used_gb,
      dram_total_gb,
      temp_c:
        tempSample?.value != null ? Number(tempSample.value.toFixed(2)) : null,
      health_ok,
      age_seconds: ageSeconds(newestTs),
    };
  }
}
