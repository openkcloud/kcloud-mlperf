import { useCallback, useEffect, useRef, useState } from 'react';

import { httpClient } from '@/libs/http-client';

// -----------------------------------------------------------------------
// Backend wire types — must mirror server/src/realtime/realtime.service.ts
// -----------------------------------------------------------------------

type WireMetricsStatus = 'available' | 'unavailable' | 'pending';

type WireSlotState =
  | 'idle'
  | 'queued'
  | 'running'
  | 'preparing'
  | 'completed'
  | 'failed'
  | 'stale'
  | 'unavailable'
  | 'unknown'
  | 'error'
  | 'pending_join';

/**
 * Per-slot telemetry block emitted by RealtimeService alongside the exam
 * status. All fields optional — GPU slots (DCGM-backed) expose gpu_util_pct +
 * fb_*_mib + mem_copy_util_pct; RNGD slots expose util_pct + alive +
 * dram_*_gb; Atom+ slots expose util_pct + health_ok + dram_*_gb. Shared:
 * power_w, temp_c, age_seconds, source, exporter_status.
 */
export type WireSlotTelemetry = {
  source?: string;
  exporter_status?: string;
  // GPU (DCGM)
  gpu_util_pct?: number;
  mem_copy_util_pct?: number;
  fb_used_mib?: number;
  fb_free_mib?: number;
  fb_total_mib?: number;
  // NPU (RNGD + Atom+) — shared util %
  util_pct?: number;
  // RNGD-only liveness
  alive?: number;
  // Atom+ health
  health_ok?: boolean;
  // Shared power/thermal/age
  power_w?: number;
  temp_c?: number;
  // NPU DRAM
  dram_used_gb?: number;
  dram_total_gb?: number;
  age_seconds?: number;
};

type WireRealtimeSlot = {
  device_type: 'gpu' | 'npu';
  vendor: 'nvidia' | 'furiosa' | 'rebellions';
  model: string;
  node: string;
  slot_id: number;
  status: WireSlotState;
  pending_join_reason?: string;
  /** ISO timestamp of last heartbeat; populated when status is 'stale'. */
  last_seen: string | null;
  current_exam: {
    id: number;
    kind: 'mp' | 'mm' | 'npu';
    exam_name: string | null;
    elapsed_seconds: number;
  } | null;
  last_known_metric: { tps: number | null; tt100t_seconds: number | null };
  last_metric_timestamp: string | null;
  metrics_status: WireMetricsStatus;
  telemetry?: WireSlotTelemetry;
};

type WireRealtimeSnapshot = {
  timestamp: string;
  slots: WireRealtimeSlot[];
  sweep_progress: {
    completed: number;
    total: number;
    active_sweep_id: number | null;
    paused: boolean;
  };
  operator_race_alerts: number;
};

// -----------------------------------------------------------------------
// Flat shape consumed by DeviceRealtimeDashboard. The backend uses nested
// objects (current_exam, last_known_metric); here we flatten them for
// rendering convenience and explicitly preserve null + status reasoning.
// -----------------------------------------------------------------------

export type MetricsStatus = WireMetricsStatus;

export type RealtimeExamSlot = {
  /** Slot-join key — equals the device `model` (e.g. 'NVIDIA-L40-44GiB'). */
  gpu_type: string;
  device_type: 'gpu' | 'npu';
  vendor: 'nvidia' | 'furiosa' | 'rebellions';
  model: string;
  node: string;
  exam_id: number | null;
  exam_name: string | null;
  /** Benchmark kind from the running exam, null when slot is idle. */
  exam_kind: 'mp' | 'mm' | 'npu' | null;
  /** Capitalized status string used by the StatusChip component. */
  status: string;
  elapsed_seconds: number | null;
  tps: number | null;
  tt100t: number | null;
  sweep_cell_id: number | null;
  /** Why metrics may be missing — never blank, never faked. */
  metrics_status: MetricsStatus;
  /** ISO8601 timestamp of the last emitted metric, or null. */
  last_metric_timestamp: string | null;
  /** ISO8601 timestamp of last heartbeat; set when status is 'Stale'. */
  last_seen: string | null;
  /** Set when status is 'Pending Join' — explains why the device is offline. */
  pending_join_reason: string | null;
  /** Latest per-slot DCGM/Furiosa/Rebellions telemetry snapshot, or null. */
  telemetry: WireSlotTelemetry | null;
  /** Slot identifier within the node (used for history-buffer key). */
  slot_id: number;
};

export type RealtimeSnapshot = {
  slots: RealtimeExamSlot[];
  sweep_progress: { completed: number; total: number; paused: boolean };
  operator_race_alerts: number;
  timestamp: string;
};

type UseRealtimeExamsOptions = {
  pollIntervalMs?: number;
};

/**
 * Rolling history buffer of telemetry frames, keyed by `${node}/${slot_id}`.
 * Cap is HISTORY_MAX (~60 frames = 2 min at the backend's 2-second cadence).
 */
export type TelemetryHistory = Record<string, WireSlotTelemetry[]>;

type UseRealtimeExamsResult = {
  snapshot: RealtimeSnapshot | null;
  connected: boolean;
  error: string | null;
  telemetryHistory: TelemetryHistory;
};

const HISTORY_MAX = 60;

/** Key used by both the hook (append) and DeviceCard (read). */
export const telemetryHistoryKey = (node: string, slot_id: number): string =>
  `${node}/${slot_id}`;

const FALLBACK_POLL_MS = 5000;
const SSE_URL = '/realtime/exams';

const EMPTY_SNAPSHOT: RealtimeSnapshot = {
  slots: [],
  sweep_progress: { completed: 0, total: 96, paused: true },
  operator_race_alerts: 0,
  timestamp: new Date().toISOString(),
};

// -----------------------------------------------------------------------

const STATUS_LABEL: Record<WireSlotState, string> = {
  idle: 'Idle',
  queued: 'Queued',
  running: 'Running',
  preparing: 'Preparing',
  completed: 'Completed',
  failed: 'Failed',
  stale: 'Stale',
  unavailable: 'Unavailable',
  unknown: 'Unknown',
  error: 'Failed',
  pending_join: 'Pending Join',
};

export function adaptSnapshot(wire: WireRealtimeSnapshot): RealtimeSnapshot {
  return {
    timestamp: wire.timestamp,
    operator_race_alerts: wire.operator_race_alerts,
    sweep_progress: {
      completed: wire.sweep_progress.completed,
      total: wire.sweep_progress.total,
      paused: wire.sweep_progress.paused,
    },
    slots: wire.slots.map((s) => ({
      // gpu_type is the slot-join key consumed by DeviceRealtimeDashboard's
      // slotKeyFromDevice() helper — keep it equal to the device model so the
      // useDeviceRegistry-driven dashboard can match by-key.
      gpu_type: s.model,
      device_type: s.device_type,
      vendor: s.vendor,
      model: s.model,
      node: s.node,
      exam_id: s.current_exam?.id ?? null,
      exam_name: s.current_exam?.exam_name ?? null,
      exam_kind: s.current_exam?.kind ?? null,
      status: STATUS_LABEL[s.status] ?? s.status,
      elapsed_seconds: s.current_exam?.elapsed_seconds ?? null,
      tps: s.last_known_metric.tps,
      tt100t: s.last_known_metric.tt100t_seconds,
      sweep_cell_id: null,
      metrics_status: s.metrics_status,
      last_metric_timestamp: s.last_metric_timestamp,
      last_seen: s.last_seen ?? null,
      pending_join_reason: s.pending_join_reason ?? null,
      telemetry: s.telemetry ?? null,
      slot_id: s.slot_id,
    })),
  };
}

// -----------------------------------------------------------------------

export function useRealtimeExams({ pollIntervalMs = FALLBACK_POLL_MS }: UseRealtimeExamsOptions = {}): UseRealtimeExamsResult {
  const [snapshot, setSnapshot] = useState<RealtimeSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [telemetryHistory, setTelemetryHistory] = useState<TelemetryHistory>({});

  // Append the newest telemetry frame from every slot in the snapshot, trim to
  // HISTORY_MAX entries per key. Slots without telemetry are skipped (no
  // fabricated zeros).
  const appendTelemetryHistory = useCallback((snap: RealtimeSnapshot) => {
    setTelemetryHistory(prev => {
      const next: TelemetryHistory = { ...prev };
      let mutated = false;
      for (const slot of snap.slots) {
        if (!slot.telemetry) continue;
        const key = telemetryHistoryKey(slot.node, slot.slot_id);
        const prior = next[key] ?? [];
        const appended = prior.concat(slot.telemetry);
        next[key] = appended.length > HISTORY_MAX ? appended.slice(-HISTORY_MAX) : appended;
        mutated = true;
      }
      return mutated ? next : prev;
    });
  }, []);

  const esRef = useRef<EventSource | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const useFallback = useRef(false);

  const stopPoll = useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPoll = useCallback(() => {
    stopPoll();
    const fetchOnce = async () => {
      try {
        const res = await httpClient.get<WireRealtimeSnapshot>(SSE_URL + '/snapshot');
        const adapted = res.data ? adaptSnapshot(res.data) : EMPTY_SNAPSHOT;
        setSnapshot(adapted);
        appendTelemetryHistory(adapted);
        setConnected(true);
        setError(null);
      } catch {
        setSnapshot(prev => prev ?? EMPTY_SNAPSHOT);
        setConnected(false);
      }
    };
    fetchOnce();
    pollRef.current = setInterval(fetchOnce, pollIntervalMs);
  }, [pollIntervalMs, stopPoll, appendTelemetryHistory]);

  const startSSE = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    const baseURL: string = (httpClient.defaults.baseURL as string) ?? '';
    const es = new EventSource(`${baseURL}${SSE_URL}`);
    esRef.current = es;

    const onSnapshot = (ev: MessageEvent) => {
      try {
        const parsed = JSON.parse(ev.data) as unknown;
        if (!parsed || typeof parsed !== 'object') return;

        // Unwrap NestJS Sse() envelope:
        //   wire shape (verified live):  { "type": "snapshot" | "ping",
        //                                  "data": <snapshot> | { timestamp } }
        // The backend Sse() controller emits MessageEvent objects whose `type`
        // is NOT promoted to the SSE event-name on the wire (NestJS serializes
        // the whole MessageEvent into the `data:` line). So we always receive
        // the wrapper here and must extract `data`. Ignore `ping` frames.
        const wrapper = parsed as { type?: string; data?: unknown };
        if (wrapper.type === 'ping') return;
        const candidate =
          wrapper.type === 'snapshot' && wrapper.data !== undefined
            ? wrapper.data
            : parsed;

        if (
          !candidate ||
          typeof candidate !== 'object' ||
          !Array.isArray((candidate as { slots?: unknown }).slots) ||
          !(candidate as { sweep_progress?: unknown }).sweep_progress
        ) {
          // Not a snapshot — silently ignore (e.g. unknown keepalive variants).
          return;
        }

        const adapted = adaptSnapshot(candidate as WireRealtimeSnapshot);
        setSnapshot(adapted);
        appendTelemetryHistory(adapted);
        setConnected(true);
        setError(null);
      } catch {
        // JSON.parse failed → genuine malformed frame; keep last snapshot.
        setError('Malformed realtime frame — keeping last snapshot');
      }
    };

    es.addEventListener('snapshot', onSnapshot);
    // Also accept default 'message' events for tolerance with proxies that
    // strip event names. The shape check above filters out ping keepalives.
    es.onmessage = onSnapshot;

    es.onerror = () => {
      es.close();
      esRef.current = null;
      setConnected(false);
      if (!useFallback.current) {
        useFallback.current = true;
        setError('SSE unavailable — using short-poll');
        startPoll();
      }
    };
  }, [startPoll, appendTelemetryHistory]);

  useEffect(() => {
    // Probe SSE; if the endpoint returns 503 immediately we fall back to poll.
    httpClient
      .get(SSE_URL + '/health', { timeout: 3000 })
      .then(() => {
        startSSE();
      })
      .catch((err: { response?: { status?: number } }) => {
        const status = err?.response?.status;
        if (status === 503 || status === 404) {
          useFallback.current = true;
          setError('SSE unavailable — using short-poll');
          startPoll();
        } else {
          // Unknown error — try SSE anyway (might be CORS pre-flight, etc.)
          startSSE();
        }
      });

    return () => {
      esRef.current?.close();
      esRef.current = null;
      stopPoll();
    };
  }, [startSSE, startPoll, stopPoll]);

  return { snapshot, connected, error, telemetryHistory };
}
