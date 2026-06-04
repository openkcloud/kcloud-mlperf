/**
 * Classified failure reasons for benchmark Job pods (WS-C01, mega-plan v2.2).
 *
 * Populated by `inferFailureReason()` in `run-reconciler/failure-heuristics.ts`
 * after a Job transitions to Failed. The Job-watcher pulls the pod's status
 * + the last 200 lines of stderr (best-effort, via kubectl logs or Loki) and
 * runs the heuristics table.
 *
 * Two `UNKNOWN_*` buckets distinguish "we have logs but no rule matched"
 * (UNKNOWN_WITH_LOGS) from "the pod died before producing any stderr"
 * (UNKNOWN_NO_LOGS); WS-C04 auto-attaches DescribePod / events / DaemonSet
 * status to `diagnostic_dump` only for the UNKNOWN_* cases, so operators have
 * something to triage.
 */
export enum FailureReason {
  /** Pod was OOM-killed (status reason 'OOMKilled' OR exit code 137). */
  POD_OOM = 'POD_OOM',
  /** Image pull failed (ErrImagePull / ImagePullBackOff). */
  POD_IMAGE_PULL = 'POD_IMAGE_PULL',
  /** Device plugin (e.g. NPU, GPU) was missing / not advertised on the node. */
  DEVICE_PLUGIN_MISSING = 'DEVICE_PLUGIN_MISSING',
  /** Model weights / safetensors missing or CUDA init failed. */
  MODEL_LOAD_FAIL = 'MODEL_LOAD_FAIL',
  /** Precision / dtype mismatch (FP8 vs BF16, etc.). */
  PRECISION_MISMATCH = 'PRECISION_MISMATCH',
  /** Inference timed out / deadline exceeded. */
  INFERENCE_TIMEOUT = 'INFERENCE_TIMEOUT',
  /** stderr was non-empty but no heuristic matched (operator must investigate). */
  UNKNOWN_WITH_LOGS = 'UNKNOWN_WITH_LOGS',
  /** stderr empty AND pod died early (default; triggers WS-C04 dump). */
  UNKNOWN_NO_LOGS = 'UNKNOWN_NO_LOGS',
}
