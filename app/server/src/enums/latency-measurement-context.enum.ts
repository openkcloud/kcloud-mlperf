/**
 * Where in the call chain a latency datum was measured (US-005).
 *
 * Audit found GPU latency is captured client-side as wall-clock per request,
 * while NPU latency is captured server-side via the SSE token stream's first
 * frame timestamp. The two are NOT comparable — server-side measurements
 * exclude HTTP/queue/router time. Tagging every result row with this enum
 * lets the comparison page warn when a researcher pairs runs from different
 * measurement contexts.
 */
export enum LatencyMeasurementContext {
  /** Client-side wall clock around the request (used by MLPerf GPU jobs). */
  CLIENT_WALL_CLOCK = 'CLIENT_WALL_CLOCK',
  /** Server-side timing of the first SSE token frame (used by NPU eval). */
  SERVER_TOKEN_STREAM = 'SERVER_TOKEN_STREAM',
  /** Unknown / not annotated (legacy rows, MMLU rows that have no latency). */
  UNKNOWN = 'UNKNOWN',
}
