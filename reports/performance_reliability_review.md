# Performance & Reliability Review
**Generated:** 2026-04-28 | **Run ID:** 20260428-075351-71c9c77 | **Lane:** I

---

## 1. SSE Hot Path — `buildSnapshot()` on every tick

`RealtimeController` calls `realtimeService.buildSnapshot()` every 2 seconds per connected subscriber, up to 20 subscribers (`MAX_SUBSCRIBERS = 20`). Each `buildSnapshot()` invocation issues:

1. `mpExamRepo.find({ where: { status: In([RUNNING, PREPARING]) } })` — full table scan filtered by status.
2. `mmExamRepo.find({ where: { status: In([RUNNING, PREPARING]) } })` — same.
3. `mpResultRepo.createQueryBuilder().where('exam_id IN (...)').orderBy('created_at DESC').getMany()` — unbounded result fetch.
4. `gpuSweepService.getStatus()` — `sweepRepo.findOne()` by `activeSweepId`.

With 20 clients connected this is up to **80 DB queries per 2-second window (2400/min)**. Under a full 110-cell sweep where 4 exams may be active simultaneously, query 3 returns up to `4 × retry_num(3) = 12` rows per tick but with no LIMIT clause. The snapshot is not cached or shared between subscribers. Remediation: introduce a 2-second shared snapshot cache in `RealtimeService`.

---

## 2. gRPC Poll Loop — No Deadline, No Keep-Alive

`MpExamService` and `MmExamService` each schedule a `setTimeout` callback that calls `executeCreateGrpcExam()`, which calls `lastValueFrom(getExamStatus(...))`. The gRPC channel has no configured deadline (no `grpc.max_receive_message_length`, no per-RPC timeout wrapper). If the k8s operator pod is unresponsive, the `lastValueFrom` promise hangs indefinitely. The NestJS scheduler will accumulate stalled promises, preventing the event loop from processing other requests. Under a 110-cell sweep with retry_num=3, up to `110 × 3 = 330` `setTimeout` callbacks are outstanding simultaneously.

The 30-second minimum delay (`minDelay = 30_000` in `scheduleExam`) ensures the operator CRD has time to initialize, which is a reasonable guard. However, there is no maximum timeout on the gRPC response itself.

---

## 3. Result-File Parsing — Synchronous NFS Read Under Event Loop

`MpExamResultService.extractSummaryData()` and `extractAddedResultData()` use `fsPromise.readFile()` (async), which is correct. However, `FilesService.getDatasetsFiles()` uses `fs.readdirSync()` (synchronous) — this blocks the Node.js event loop for the duration of the NFS directory listing. On a slow or stalled NFS mount, this can stall all pending requests. The `getSettings()` method also uses `fs.readFileSync()`.

---

## 4. Retry Behaviour

`retry_num` is stored on each cell (default 3) and passed to the gRPC `createExam` call as `repeatCount`. The gRPC operator handles the repeat loop internally. The `willRetry` variable in `dispatchCell()`'s catch block (line 388) is computed but never acted upon — there is no application-layer retry. A dispatch failure immediately sets the cell to `RACE_FAILED` and re-throws, halting the sweep queue for that node until `canDispatchOn` clears `busy`.

---

## 5. Node Mutex Stale-Lock Risk

`nodeMutex[node].busy = true` is set in `dispatchCell()` and cleared either in the catch block (on error) or by `markCellComplete()` (on success). If the process restarts between dispatch and completion, the new instance starts with `busy = false` (correct for new dispatches) but `activeSweepId = null`, so `runQueue()` is never resumed. The cell stays `DISPATCHED` in the DB forever. Additionally, `markCellComplete()` is only called from external callers (the realtime poller); if the poller is also lost, the sweep stalls with no timeout-based recovery.

---

## 6. Log Volume

The `LoggerInterceptor` logs every request (`console.log('Request started...')` + response time). With SSE long-lived connections, the request-start log fires once per SSE connection open and the response-time log fires only on close. With 20 subscribers and the 2-second interval, the interceptor itself is quiet, but `buildSnapshot()` logs no per-tick output. More concerning: `mp-exam.service.ts` and `mm-exam.service.ts` emit `console.log` (not the NestJS Logger) for every `scheduleExam` call and every `executeCreateGrpcExam` invocation, producing ~2 log lines per exam per poll cycle. For 330 scheduled exams this is ~660 unstructured log lines not captured by Loki's label-based routing.

---

## 7. Storage Growth

Result files accumulate under `mnt/result/mlperf-{examId}/{repeatCount}/` and `mnt/result/mmlu-{examId}/{repeatCount}/`. There is no cleanup or TTL logic in the backend. A full 110-cell sweep with retry_num=3 produces `110 × 3 = 330` result directories. `exam_result.zip` and `submission_report.zip` files are served via the files controller but never pruned. Over multiple sweep runs, NFS usage grows without bound.

---

## 8. Concurrent Sweep Execution

`GpuSweepService` allows only one `activeSweepId` in memory. A second `startSweep()` call while one is running will create a new DB sweep row and a new `runQueue()` goroutine, overwriting `activeSweepId`. Both queue runners now compete for the same two node mutexes. The second runner will find nodes busy and return without dispatching, but the first runner has lost its `activeSweepId` reference and `pauseActiveSweep()` will operate on the second sweep. This is a concurrency correctness gap.

---

## 9. Failure Recovery

There is no watchdog or reconciliation loop. If a cell is stuck in `DISPATCHED` status (operator died, gRPC stream lost), nothing in the backend ever times it out. The sweep progresses only when `markCellComplete()` is called, which is driven by the SSE realtime path calling `gpuSweepService.getStatus()`. If SSE has no subscribers, `markCellComplete()` is never triggered and the sweep freezes.

---

## 10. Timeouts Summary

| Path | Current Timeout | Risk |
|---|---|---|
| gRPC `lastValueFrom(getExamStatus)` | None | HIGH — hangs indefinitely |
| Loki `http.get` (via HttpModule) | None | HIGH — stalls exam status |
| SSE slow-client write | None | MED — unbounded buffer |
| `fs.readdirSync` on NFS (FilesService) | None | MED — blocks event loop |
| `scheduleExam` setTimeout delay | min 30s, max = startTime diff | OK |

