#!/usr/bin/env bash
# Runbook: GPU MMLU benchmark execution
# Hardware: NVIDIA GPU (L40 / A40 / A6000)
# Benchmark: mmlu (MMLU-Pro, Llama-3.1-8B-Instruct, FP16)
#
# Usage:
#   EXAM_ID=7 GPU_TYPE=NVIDIA-L40 bash scripts/runbooks/gpu-mmlu.sh

set -euo pipefail

EXAM_ID="${EXAM_ID:?Set EXAM_ID to the mm_exam row id}"
GPU_TYPE="${GPU_TYPE:-NVIDIA-L40}"
BACKEND_URL="${BACKEND_URL:-http://localhost:3000}"
MODEL="${MODEL:-meta-llama/Llama-3.1-8B-Instruct}"
PRECISION="${PRECISION:-FP16}"
DATASET="${DATASET:-mmlu-pro}"

RESULT_BASE="results/mmlu-${EXAM_ID}"
START_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "[gpu-mmlu] Starting exam ID=${EXAM_ID} GPU=${GPU_TYPE}"

# 1. Trigger via backend
curl -sf -X POST "${BACKEND_URL}/api/mm-exam/${EXAM_ID}/status" \
  -H 'Content-Type: application/json' || true

# 2. Poll for completion (max 2h)
for i in $(seq 1 240); do
  STATUS_JSON=$(curl -sf "${BACKEND_URL}/api/mm-exam/${EXAM_ID}/status" || echo '{"status":"Unknown"}')
  STATUS=$(echo "$STATUS_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','Unknown'))" 2>/dev/null || echo "Unknown")
  echo "[gpu-mmlu] Poll ${i}/240: status=${STATUS}"
  if [[ "$STATUS" == "Completed" ]]; then
    break
  elif [[ "$STATUS" == "Error" || "$STATUS" == "Stopped" ]]; then
    FAILURE_REASON=$(echo "$STATUS_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('message','unknown error'))" 2>/dev/null || echo "unknown error")
    COMPLETED_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    ELAPSED=$(python3 -c "from datetime import datetime; s=datetime.fromisoformat('${START_TIME}'); e=datetime.fromisoformat('${COMPLETED_TIME}'); print(int((e-s).total_seconds()))" 2>/dev/null || echo "0")
    mkdir -p "${RESULT_BASE}/1/summary"
    cat > "${RESULT_BASE}/result.json" <<EOF
{
  "run_id": "mmlu-${EXAM_ID}-1",
  "hardware": "${GPU_TYPE}",
  "vendor": "nvidia",
  "benchmark": "mmlu",
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
  "artifact_path": "${RESULT_BASE}/1/",
  "config_fingerprint": "unfingerprinted"
}
EOF
    node scripts/import-benchmark-result.ts --path "${RESULT_BASE}/result.json" || true
    exit 1
  fi
  sleep 30
done

COMPLETED_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
ELAPSED=$(python3 -c "from datetime import datetime; s=datetime.fromisoformat('${START_TIME}'); e=datetime.fromisoformat('${COMPLETED_TIME}'); print(int((e-s).total_seconds()))" 2>/dev/null || echo "0")

# 3. Parse accuracy from summary.txt
SUMMARY_FILE="server/mnt/result/mmlu-${EXAM_ID}/1/summary/summary.txt"
ACC_TOTAL="null"

if [[ -f "$SUMMARY_FILE" ]]; then
  ACC_TOTAL=$(grep -oP 'Average accuracy:\s*\K[0-9.]+' "$SUMMARY_FILE" 2>/dev/null || echo "null")
fi

# 4. Write canonical result.json
mkdir -p "${RESULT_BASE}/1/summary"
cat > "${RESULT_BASE}/result.json" <<EOF
{
  "run_id": "mmlu-${EXAM_ID}-1",
  "hardware": "${GPU_TYPE}",
  "vendor": "nvidia",
  "benchmark": "mmlu",
  "model": "${MODEL}",
  "precision": "${PRECISION}",
  "started_at": "${START_TIME}",
  "completed_at": "${COMPLETED_TIME}",
  "status": "completed",
  "failure_reason": null,
  "tt100t_seconds": null,
  "elapsed_seconds": ${ELAPSED},
  "throughput_tokens_per_sec": null,
  "raw_metrics": {
    "result_acc_total": ${ACC_TOTAL}
  },
  "logs_path": "${RESULT_BASE}/1/",
  "artifact_path": "${RESULT_BASE}/1/",
  "config_fingerprint": "unfingerprinted"
}
EOF

echo "[gpu-mmlu] Wrote result.json to ${RESULT_BASE}/result.json"
node scripts/import-benchmark-result.ts --path "${RESULT_BASE}/result.json"
echo "[gpu-mmlu] Done."
