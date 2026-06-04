/**
 * WS-C01 — heuristics that classify a failed Job's pod into a FailureReason.
 * Each enum value gets at least one positive test case plus the two edge
 * buckets (UNKNOWN_WITH_LOGS / UNKNOWN_NO_LOGS).
 */
import { FailureReason } from '../enums/failure-reason.enum';
import {
  inferFailureReason,
  PodStatusForHeuristics,
} from './failure-heuristics';

const podRunning: PodStatusForHeuristics = {
  phase: 'Running',
  reason: null,
  exitCode: null,
};

const podFailedEarly: PodStatusForHeuristics = {
  phase: 'Failed',
  reason: null,
  exitCode: 1,
};

describe('inferFailureReason (WS-C01)', () => {
  describe('POD_OOM', () => {
    it('matches when pod status reason is OOMKilled', () => {
      expect(
        inferFailureReason(
          { phase: 'Failed', reason: 'OOMKilled', exitCode: 1 },
          '',
        ),
      ).toBe(FailureReason.POD_OOM);
    });
    it('matches when exit code is 137 (SIGKILL from OOM)', () => {
      expect(
        inferFailureReason(
          { phase: 'Failed', reason: 'Error', exitCode: 137 },
          'killed',
        ),
      ).toBe(FailureReason.POD_OOM);
    });
  });

  describe('POD_IMAGE_PULL', () => {
    it('matches ErrImagePull', () => {
      expect(
        inferFailureReason(
          { phase: 'Pending', reason: 'ErrImagePull', exitCode: null },
          '',
        ),
      ).toBe(FailureReason.POD_IMAGE_PULL);
    });
    it('matches ImagePullBackOff', () => {
      expect(
        inferFailureReason(
          { phase: 'Pending', reason: 'ImagePullBackOff', exitCode: null },
          '',
        ),
      ).toBe(FailureReason.POD_IMAGE_PULL);
    });
  });

  describe('DEVICE_PLUGIN_MISSING', () => {
    it('matches "no available device" stderr', () => {
      expect(
        inferFailureReason(
          podFailedEarly,
          'RuntimeError: no available device for inference',
        ),
      ).toBe(FailureReason.DEVICE_PLUGIN_MISSING);
    });
    it('matches "device plugin not found" stderr', () => {
      expect(
        inferFailureReason(podFailedEarly, 'kubelet: device plugin not found'),
      ).toBe(FailureReason.DEVICE_PLUGIN_MISSING);
    });
  });

  describe('MODEL_LOAD_FAIL', () => {
    it('matches "model not found"', () => {
      expect(
        inferFailureReason(
          podFailedEarly,
          'OSError: model meta-llama/Llama-3.1-8B-Instruct not found',
        ),
      ).toBe(FailureReason.MODEL_LOAD_FAIL);
    });
    it('matches "model.safetensors"', () => {
      expect(
        inferFailureReason(
          podFailedEarly,
          'FileNotFoundError: /weights/model.safetensors',
        ),
      ).toBe(FailureReason.MODEL_LOAD_FAIL);
    });
    it('matches "cuda init fail"', () => {
      expect(
        inferFailureReason(podFailedEarly, 'cuda init failed: device 0'),
      ).toBe(FailureReason.MODEL_LOAD_FAIL);
    });
  });

  describe('PRECISION_MISMATCH', () => {
    it('matches "dtype mismatch"', () => {
      expect(
        inferFailureReason(
          podFailedEarly,
          'RuntimeError: dtype mismatch in linear layer',
        ),
      ).toBe(FailureReason.PRECISION_MISMATCH);
    });
    it('matches FP8/BF16 precision text', () => {
      expect(
        inferFailureReason(podFailedEarly, 'expected fp8 but got bf16 weights'),
      ).toBe(FailureReason.PRECISION_MISMATCH);
    });
    it('matches "precision mismatch"', () => {
      expect(
        inferFailureReason(podFailedEarly, 'Precision mismatch detected'),
      ).toBe(FailureReason.PRECISION_MISMATCH);
    });
  });

  describe('INFERENCE_TIMEOUT', () => {
    it('matches "timeout"', () => {
      expect(
        inferFailureReason(podRunning, 'inference timeout after 600s'),
      ).toBe(FailureReason.INFERENCE_TIMEOUT);
    });
    it('matches "timed out"', () => {
      expect(
        inferFailureReason(podRunning, 'request timed out waiting for token'),
      ).toBe(FailureReason.INFERENCE_TIMEOUT);
    });
    it('matches "deadline exceeded"', () => {
      expect(inferFailureReason(podRunning, 'context deadline exceeded')).toBe(
        FailureReason.INFERENCE_TIMEOUT,
      );
    });
  });

  describe('UNKNOWN_WITH_LOGS', () => {
    it('returns UNKNOWN_WITH_LOGS when stderr has content but nothing matches', () => {
      expect(
        inferFailureReason(
          podFailedEarly,
          'some unexpected message that does not match any rule',
        ),
      ).toBe(FailureReason.UNKNOWN_WITH_LOGS);
    });
  });

  describe('UNKNOWN_NO_LOGS', () => {
    it('returns UNKNOWN_NO_LOGS when stderr is empty and pod died early', () => {
      expect(inferFailureReason(podFailedEarly, '')).toBe(
        FailureReason.UNKNOWN_NO_LOGS,
      );
    });
    it('returns UNKNOWN_NO_LOGS for whitespace-only stderr', () => {
      expect(inferFailureReason(podFailedEarly, '   \n\t  ')).toBe(
        FailureReason.UNKNOWN_NO_LOGS,
      );
    });
  });

  describe('priority ordering', () => {
    it('OOM beats stderr-based heuristics', () => {
      // Pod has OOMKilled status AND a timeout-looking stderr; OOM wins.
      expect(
        inferFailureReason(
          { phase: 'Failed', reason: 'OOMKilled', exitCode: 137 },
          'request timed out waiting for token',
        ),
      ).toBe(FailureReason.POD_OOM);
    });
    it('image pull beats stderr-based heuristics', () => {
      expect(
        inferFailureReason(
          { phase: 'Pending', reason: 'ImagePullBackOff', exitCode: null },
          'model not found',
        ),
      ).toBe(FailureReason.POD_IMAGE_PULL);
    });
  });
});
