#!/usr/bin/env bash
# Runbook: FuriosaAI RNGD NPU MLPerf benchmark execution
# Hardware: RNGD NPU (Furiosa)
# Benchmark: mlperf (offline scenario, Llama-3.1-8B-Instruct, FP8)
#
# Prerequisites:
#   - kubectl access to ETRI k8s cluster with RNGD node
#   - NPU node labelled: furiosa.ai/rngd=present
#   - npu_exam row created in DB first
#
# Usage:
#   NPU_EXAM_ID=1 bash scripts/runbooks/npu-rngd-mlperf.sh

set -euo pipefail

NPU_EXAM_ID="${NPU_EXAM_ID:?Set NPU_EXAM_ID to the npu_exam row id}"
BACKEND_URL="${BACKEND_URL:-http://localhost:3000}"
MODEL="${MODEL:-meta-llama/Llama-3.1-8B-Instruct}"
PRECISION="${PRECISION:-FP8}"
DATASET="${DATASET:-cnn-dailymail}"

RESULT_BASE="results/npu-rngd-${NPU_EXAM_ID}"
START_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "[npu-rngd] Starting NPU exam ID=${NPU_EXAM_ID}"

# 1. Trigger via npu-eval API endpoint
curl -sf -X POST "${BACKEND_URL}/api/npu-eval/${NPU_EXAM_ID}/status" \
  -H 'Content-Type: application/json' || true

# 2. Poll for completion (max 3h — NPU runs can be longer)
for i in $(seq 1 360); do
  STATUS_JSON=$(curl -sf "${BACKEND_URL}/api/npu-eval/${NPU_EXAM_ID}" || echo '{"status":"Unknown"}')
  STATUS=$(echo "$STATUS_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status',d.get('data',{}).get('status','Unknown')))" 2>/dev/null || echo "Unknown")
  echo "[npu-rngd] Poll ${i}/360: status=${STATUS}"
  if [[ "$STATUS" == "Completed" ]]; then
    break
  elif [[ "$STATUS" == "Error" || "$STATUS" == "Stopped" ]]; then
    FAILURE_REASON=$(echo "$STATUS_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error_log',d.get('message','unknown error')))" 2>/dev/null || echo "BackoffLimitExceeded")
    COMPLETED_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    ELAPSED=$(python3 -c "from datetime import datetime; s=datetime.fromisoformat('${START_TIME}'); e=datetime.fromisoformat('${COMPLETED_TIME}'); print(int((e-s).total_seconds()))" 2>/dev/null || echo "0")
    mkdir -p "${RESULT_BASE}"
    cat > "${RESULT_BASE}/result.json" <<EOF
{
  "run_id": "npu-rngd-${NPU_EXAM_ID}-1",
  "hardware": "RNGD",
  "vendor": "furiosa",
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
  "logs_path": "${RESULT_BASE}/",
  "artifact_path": "${RESULT_BASE}/",
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

# 3. Fetch final metrics from backend
RESULT_JSON=$(curl -sf "${BACKEND_URL}/api/npu-eval/${NPU_EXAM_ID}" || echo '{}')
TT100T=$(echo "$RESULT_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); r=d.get('results',d.get('data',{}).get('results',[])); last=r[-1] if r else {}; print(last.get('result_tt100t','null'))" 2>/dev/null || echo "null")
TPS=$(echo "$RESULT_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); r=d.get('results',d.get('data',{}).get('results',[])); last=r[-1] if r else {}; print(last.get('result_tps','null'))" 2>/dev/null || echo "null")
SPS=$(echo "$RESULT_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); r=d.get('results',d.get('data',{}).get('results',[])); last=r[-1] if r else {}; print(last.get('result_sps','null'))" 2>/dev/null || echo "null")

# 4. Write canonical result.json
mkdir -p "${RESULT_BASE}"
cat > "${RESULT_BASE}/result.json" <<EOF
{
  "run_id": "npu-rngd-${NPU_EXAM_ID}-1",
  "hardware": "RNGD",
  "vendor": "furiosa",
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
    "result_tt100t": ${TT100T},
    "result_tps": ${TPS},
    "result_sps": ${SPS}
  },
  "logs_path": "${RESULT_BASE}/",
  "artifact_path": "${RESULT_BASE}/",
  "config_fingerprint": "unfingerprinted"
}
EOF

echo "[npu-rngd] Wrote result.json to ${RESULT_BASE}/result.json"
node scripts/import-benchmark-result.ts --path "${RESULT_BASE}/result.json"
echo "[npu-rngd] Done."
