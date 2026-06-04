import { Injectable, Logger } from '@nestjs/common';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

/**
 * One row from a Prometheus instant-vector query response.
 * `value` is the parsed sample value (null if the upstream returned NaN or no
 * sample), `timestamp` is the unix-seconds the sample was scraped at, and
 * `labels` carries every label so callers can filter further (e.g. by
 * Hostname / gpu / model_name).
 */
export interface PrometheusSample {
  value: number | null;
  timestamp: number;
  labels: Record<string, string>;
}

interface PrometheusQueryResponse {
  status: 'success' | 'error';
  data?: {
    resultType: string;
    result: Array<{
      metric: Record<string, string>;
      value: [number, string];
    }>;
  };
  errorType?: string;
  error?: string;
}

/** Per-query timeout — short on purpose so SSE remains responsive. */
const DEFAULT_TIMEOUT_MS = 2000;

/**
 * Thin Prometheus HTTP-API client backed by Node's built-in http/https modules
 * (no axios — see the v36 constraint to avoid new package.json deps).
 *
 * Only instant queries are supported for now; the SSE snapshot loop needs a
 * point-in-time reading per slot and nothing more.
 */
@Injectable()
export class PrometheusClient {
  private readonly logger = new Logger(PrometheusClient.name);
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl =
      process.env.PROMETHEUS_URL ??
      'http://prometheus-server.monitoring.svc.cluster.local';
  }

  /**
   * Run an instant query against /api/v1/query. Returns one sample per
   * matching series; on timeout / parse error / non-success status we log and
   * return an empty array so callers can degrade gracefully.
   */
  async instantQuery(
    query: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<PrometheusSample[]> {
    const url = `${this.baseUrl}/api/v1/query?query=${encodeURIComponent(query)}`;

    try {
      const raw = await this.httpGet(url, timeoutMs);
      const parsed = JSON.parse(raw) as PrometheusQueryResponse;

      if (parsed.status !== 'success' || !parsed.data) {
        this.logger.warn(
          `Prometheus query non-success: status=${parsed.status} errorType=${parsed.errorType ?? ''} error=${parsed.error ?? ''} query=${query}`,
        );
        return [];
      }

      return parsed.data.result.map((row) => {
        const [ts, valStr] = row.value;
        const numeric = Number(valStr);
        return {
          value: Number.isFinite(numeric) ? numeric : null,
          timestamp: ts,
          labels: row.metric,
        };
      });
    } catch (err) {
      this.logger.warn(
        `Prometheus query failed (${(err as Error).message}) query=${query}`,
      );
      return [];
    }
  }

  /**
   * R8 (perf/Watt): run an instant query of `avg_over_time(<metric>[<window>s])`
   * so callers get the mean of a metric over a fixed window. When `atTime`
   * (unix seconds) is supplied it is appended as `&time=` so the range is
   * evaluated ending at that instant (e.g. a run's end_at) instead of "now".
   *
   * `metric` is the bare series selector WITHOUT the range vector, e.g.
   * `DCGM_FI_DEV_POWER_USAGE{Hostname="node2"}`. We wrap it in avg_over_time
   * here. Same degrade-gracefully contract as instantQuery: on any failure we
   * log and return [].
   */
  async avgOverTimeQuery(
    metric: string,
    windowSeconds: number,
    atTime?: number,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<PrometheusSample[]> {
    const window = Math.max(1, Math.round(windowSeconds));
    const query = `avg_over_time(${metric}[${window}s])`;
    let url = `${this.baseUrl}/api/v1/query?query=${encodeURIComponent(query)}`;
    if (atTime != null && Number.isFinite(atTime)) {
      url += `&time=${Math.round(atTime)}`;
    }

    try {
      const raw = await this.httpGet(url, timeoutMs);
      const parsed = JSON.parse(raw) as PrometheusQueryResponse;

      if (parsed.status !== 'success' || !parsed.data) {
        this.logger.warn(
          `Prometheus avg_over_time non-success: status=${parsed.status} errorType=${parsed.errorType ?? ''} error=${parsed.error ?? ''} query=${query}`,
        );
        return [];
      }

      return parsed.data.result.map((row) => {
        const [ts, valStr] = row.value;
        const numeric = Number(valStr);
        return {
          value: Number.isFinite(numeric) ? numeric : null,
          timestamp: ts,
          labels: row.metric,
        };
      });
    } catch (err) {
      this.logger.warn(
        `Prometheus avg_over_time failed (${(err as Error).message}) query=${query}`,
      );
      return [];
    }
  }

  /** Resolve to the response body or reject on timeout / network error. */
  private httpGet(rawUrl: string, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(rawUrl);
      } catch (err) {
        reject(err as Error);
        return;
      }
      const client = parsedUrl.protocol === 'https:' ? https : http;

      const req = client.get(
        rawUrl,
        { timeout: timeoutMs },
        (res: http.IncomingMessage) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            if (
              res.statusCode != null &&
              res.statusCode >= 200 &&
              res.statusCode < 300
            ) {
              resolve(body);
            } else {
              reject(
                new Error(
                  `HTTP ${res.statusCode ?? 'unknown'}: ${body.slice(0, 200)}`,
                ),
              );
            }
          });
          res.on('error', (err: Error) => reject(err));
        },
      );

      req.on('timeout', () => {
        req.destroy(new Error(`request timed out after ${timeoutMs}ms`));
      });
      req.on('error', (err: Error) => reject(err));
    });
  }
}
