import { FailureReason } from '../enums/failure-reason.enum';

/**
 * Subset of `V1PodStatus` the heuristics actually need. We avoid a hard
 * dependency on the kubernetes client here so the rules stay pure and the
 * unit tests don't have to construct a full V1PodStatus.
 *
 * `reason` is the container-state reason (e.g. 'OOMKilled', 'ErrImagePull',
 * 'ImagePullBackOff'); the watcher extracts it from
 * pod.status.containerStatuses[*].state.{waiting|terminated}.reason.
 * `exitCode` is the terminated container's exit code (e.g. 137 for SIGKILL).
 */
export interface PodStatusForHeuristics {
  phase: string | null;
  reason: string | null;
  exitCode: number | null;
}

/**
 * Classify a failed benchmark Job pod (WS-C01, mega-plan v2.2 patch #8).
 *
 * Priority ordering matters: pod-status signals (OOM, image pull) beat
 * stderr-based pattern matches because a pod that was OOM-killed may produce
 * misleading log fragments (e.g. half-formatted timeout messages) before the
 * kernel terminates it. We classify by *cause*, not by *symptom*.
 *
 * The final two buckets are book-ends: any non-empty stderr that we can't
 * classify falls into UNKNOWN_WITH_LOGS so an operator can grep the row,
 * and a pod that died with no stderr at all falls into UNKNOWN_NO_LOGS,
 * which is the signal WS-C04 uses to auto-attach DescribePod/events/DaemonSet
 * diagnostics.
 */
export function inferFailureReason(
  podStatus: PodStatusForHeuristics,
  stderrTail: string,
): FailureReason {
  // 1. Pod-status signals (highest priority — pre-empts any stderr noise).
  if (podStatus.reason === 'OOMKilled' || podStatus.exitCode === 137) {
    return FailureReason.POD_OOM;
  }
  if (
    podStatus.reason === 'ErrImagePull' ||
    podStatus.reason === 'ImagePullBackOff'
  ) {
    return FailureReason.POD_IMAGE_PULL;
  }

  // 2. stderr pattern matches. Empty stderr → UNKNOWN_NO_LOGS (book-end).
  const stderr = (stderrTail || '').trim();
  if (stderr.length === 0) {
    return FailureReason.UNKNOWN_NO_LOGS;
  }

  if (/no available device|device plugin not found/i.test(stderr)) {
    return FailureReason.DEVICE_PLUGIN_MISSING;
  }
  if (/model.*not found|model.*safetensors|cuda.*init.*fail/i.test(stderr)) {
    return FailureReason.MODEL_LOAD_FAIL;
  }
  if (/dtype mismatch|fp8.*bf16|precision.*mismatch/i.test(stderr)) {
    return FailureReason.PRECISION_MISMATCH;
  }
  if (/timeout|timed out|deadline exceeded/i.test(stderr)) {
    return FailureReason.INFERENCE_TIMEOUT;
  }

  // 3. Book-end: had logs, nothing matched.
  return FailureReason.UNKNOWN_WITH_LOGS;
}
