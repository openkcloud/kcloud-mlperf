import { useCallback, useEffect, useRef, useState } from 'react';

import { httpClient } from '@/libs/http-client';

// -----------------------------------------------------------------------
// Types matching the SSE snapshot shape from /realtime/exams
// -----------------------------------------------------------------------

export type RealtimeExamSlot = {
  gpu_type: string;
  node: string;
  exam_id: number | null;
  exam_name: string | null;
  status: string;
  elapsed_seconds: number | null;
  tps: number | null;
  tt100t: number | null;
  sweep_cell_id: number | null;
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

type UseRealtimeExamsResult = {
  snapshot: RealtimeSnapshot | null;
  connected: boolean;
  error: string | null;
};

const FALLBACK_POLL_MS = 5000;
const SSE_URL = '/realtime/exams';

const EMPTY_SNAPSHOT: RealtimeSnapshot = {
  slots: [],
  sweep_progress: { completed: 0, total: 96, paused: true },
  operator_race_alerts: 0,
  timestamp: new Date().toISOString(),
};

// -----------------------------------------------------------------------

export function useRealtimeExams({ pollIntervalMs = FALLBACK_POLL_MS }: UseRealtimeExamsOptions = {}): UseRealtimeExamsResult {
  const [snapshot, setSnapshot] = useState<RealtimeSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        const res = await httpClient.get<RealtimeSnapshot>(SSE_URL + '/snapshot');
        setSnapshot(res.data ?? EMPTY_SNAPSHOT);
        setConnected(true);
        setError(null);
      } catch {
        setSnapshot(prev => prev ?? EMPTY_SNAPSHOT);
      }
    };
    fetchOnce();
    pollRef.current = setInterval(fetchOnce, pollIntervalMs);
  }, [pollIntervalMs, stopPoll]);

  const startSSE = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    const baseURL: string = (httpClient.defaults.baseURL as string) ?? '';
    const es = new EventSource(`${baseURL}${SSE_URL}`);
    esRef.current = es;

    es.addEventListener('snapshot', (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data) as RealtimeSnapshot;
        setSnapshot(data);
        setConnected(true);
        setError(null);
      } catch {
        // malformed message — ignore
      }
    });

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
  }, [startPoll]);

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

  return { snapshot, connected, error };
}
