#!/usr/bin/env bash
# Runbook: GPU MLPerf benchmark execution
# Hardware: NVIDIA GPU (L40 / A40 / A6000)
# Benchmark: mlperf (offline scenario, Llama-3.1-8B-Instruct, FP16)
#
# Prerequisites:
#   - kubectl configured with access to the etri-llm k8s cluster
#   - Backend API running at $BACKEND_URL (default: http://localhost:3000)
#   - GPU node available with label nvidia.com/gpu=present
#   - PVC mlperf-result-pvc mounted at /mnt/result in the job pod
#
# Usage:
#   EXAM_ID=42 GPU_TYPE=NVIDIA-L40 bash scripts/runbooks/gpu-mlperf.sh

set -euo pipefail

EXAM_ID="${EXAM_ID:?Set EXAM_ID to the mp_exam row id}"
GPU_TYPE="${GPU_TYPE:-NVIDIA-L40}"
BACKEND_URL="${BACKEND_URL:-http://localhost:3000}"
REPEAT_COUNT="${REPEAT_COUNT:-1}"
SCENARIO="${SCENARIO:-Offline}"
PRECISION="${PRECISION:-FP16}"
MODEL="${MODEL:-meta-llama/Llama-3.1-8B-Instruct}"
DATASET="${DATASET:-cnn-dailymail}"
BATCH_SIZE="${BATCH_SIZE:-1}"
NUM_WORKERS="${NUM_WORKERS:-1}"
MIN_DURATION="${MIN_DURATION:-60}"

RESULT_BASE="results/mlperf-${EXAM_ID}"

echo "[gpu-mlperf] Starting exam ID=${EXAM_ID} GPU=${GPU_TYPE} scenario=${SCENARIO}"
START_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# -------------------------------------------------------------------------
# 1. Trigger benchmark via backend API (creates k8s Job via operator)
# -------------------------------------------------------------------------
echo "[gpu-mlperf] POST /api/mp-exam/${EXAM_ID}/status to trigger execution"
curl -sf -X POST "${BACKEND_URL}/api/mp-exam/${EXAM_ID}/status" \
  -H 'Content-Type: application/json' || true

# -------------------------------------------------------------------------
# 2. Poll until completed or error (max 2h)
# -------------------------------------------------------------------------
echo "[gpu-mlperf] Polling for completion..."
for i in $(seq 1 240); do
  STATUS_JSON=$(curl -sf "${BACKEND_URL}/api/mp-exam/${EXAM_ID}/status" || echo '{"status":"Unknown"}')
  STATUS=$(echo "$STATUS_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','Unknown'))" 2>/dev/null || echo "Unknown")
  echo "[gpu-mlperf] Poll ${i}/240: status=${STATUS}"
  if [[ "$STATUS" == "Completed" ]]; then
    break
  elif [[ "$STATUS" == "Error" || "$STATUS" == "Stopped" ]]; then
    FAILURE_REASON=$(echo "$STATUS_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('message','unknown error'))" 2>/dev/null || echo "unknown error")
    echo "[gpu-mlperf] ERROR: ${FAILURE_REASON}"
    COMPLETED_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    ELAPSED=$(python3 -c "from datetime import datetime; s=datetime.fromisoformat('${START_TIME}'); e=datetime.fromisoformat('${COMPLETED_TIME}'); print(int((e-s).total_seconds()))" 2>/dev/null || echo "0")
    mkdir -p "${RESULT_BASE}/1"
    cat > "${RESULT_BASE}/result.json" <<EOF
{
  "run_id": "mlperf-${EXAM_ID}-1",
  "hardware": "${GPU_TYPE}",
  "vendor": "nvidia",
  "benchmark": "mlperf",
  "model": "${MODEL}",
  "precision": "${PRECISION}",
  "started_at": "${START_TIME}",
  "completed_at": "${COMPLETED_TIME}",
  "status": "failed",
  "failure_reason": "${FAILURE_REASON}",
  "tt100t_seconds": null,
  "elapsed_seconds": ${ELAPSED},
  "throughput_tokens_per_sec": null,
  "raw_metrics": {},
  "logs_path": "${RESULT_BASE}/1/",
  "artifact_path": "${RESULT_BASE}/1/exam_result.zip",
  "config_fingerprint": "unfingerprinted"
}
EOF
    echo "[gpu-mlperf] Wrote failed result.json to ${RESULT_BASE}/result.json"
    node scripts/import-benchmark-result.ts --path "${RESULT_BASE}/result.json" || true
    exit 1
  fi
  sleep 30
done

COMPLETED_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
ELAPSED=$(python3 -c "from datetime import datetime; s=datetime.fromisoformat('${START_TIME}'); e=datetime.fromisoformat('${COMPLETED_TIME}'); print(int((e-s).total_seconds()))" 2>/dev/null || echo "0")

# -------------------------------------------------------------------------
# 3. Extract tt100t and tps from mnt/result (written by k8s job)
# -------------------------------------------------------------------------
SUMMARY_FILE="server/mnt/result/mlperf-${EXAM_ID}/1/mlperf_log_summary.txt"
ADDED_FILE="server/mnt/result/mlperf-${EXAM_ID}/1/added-result.txt"

TT100T="null"
TPS="null"
VRAM="null"
GPU_UTIL="null"

if [[ -f "$ADDED_FILE" ]]; then
  TT100T=$(python3 -c "import ast; d=ast.literal_eval(open('${ADDED_FILE}').read()); print(d.get('tt100t','null'))" 2>/dev/null || echo "null")
  VRAM=$(python3 -c "import ast; d=ast.literal_eval(open('${ADDED_FILE}').read()); print(d.get('vram_peak','null'))" 2>/dev/null || echo "null")
  GPU_UTIL=$(python3 -c "import ast; d=ast.literal_eval(open('${ADDED_FILE}').read()); print(d.get('gpu_util','null'))" 2>/dev/null || echo "null")
fi

if [[ -f "$SUMMARY_FILE" ]]; then
  TPS=$(grep -oP 'Tokens per second\s*:\s*\K[0-9.]+' "$SUMMARY_FILE" 2>/dev/null || echo "null")
fi

# -------------------------------------------------------------------------
# 4. Write canonical result.json
# -------------------------------------------------------------------------
mkdir -p "${RESULT_BASE}/1"
cat > "${RESULT_BASE}/result.json" <<EOF
{
  "run_id": "mlperf-${EXAM_ID}-1",
  "hardware": "${GPU_TYPE}",
  "vendor": "nvidia",
  "benchmark": "mlperf",
  "model": "${MODEL}",
  "precision": "${PRECISION}",
  "started_at": "${START_TIME}",
  "completed_at": "${COMPLETED_TIME}",
  "status": "completed",
  "failure_reason": null,
  "tt100t_seconds": ${TT100T},
  "elapsed_seconds": ${ELAPSED},
  "throughput_tokens_per_sec": ${TPS},
  "raw_metrics": {
    "result_perf_tps": ${TPS},
    "result_perf_sps": null,
    "result_vram_peak": ${VRAM},
    "result_gpu_util": ${GPU_UTIL}
  },
  "logs_path": "${RESULT_BASE}/1/",
  "artifact_path": "${RESULT_BASE}/1/exam_result.zip",
  "config_fingerprint": "unfingerprinted"
}
EOF

echo "[gpu-mlperf] Wrote result.json to ${RESULT_BASE}/result.json"

# -------------------------------------------------------------------------
# 5. Import into DB
# -------------------------------------------------------------------------
node scripts/import-benchmark-result.ts --path "${RESULT_BASE}/result.json"
echo "[gpu-mlperf] Done."
