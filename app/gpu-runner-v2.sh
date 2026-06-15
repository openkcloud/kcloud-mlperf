#!/bin/bash
# GPU Sequential Benchmark Runner v2
# Uses proven data sizes (100-500 samples) that complete within timeouts.
# L40 and A40 run in parallel. Each step waits for completion before next.

API="http://10.254.177.41:30980/api"
LOG="/home/kcloud/etri-llm-exam-solution/.omc/logs/gpu-runner-v2.log"
TRIGGER="/home/kcloud/etri-llm-exam-solution/.omc/state/gpu-loop-trigger.json"
POLL=30
TIMEOUT=28800  # 8h per exam max (generous)

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG"; }

wait_mp() {
  local id=$1 elapsed=0
  while [ $elapsed -lt $TIMEOUT ]; do
    status=$(curl -s "$API/mp-exam/status/$id" 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['status'])" 2>/dev/null)
    case "$status" in Completed|Error|Stopped) log "  MP#$id → $status"; return;; esac
    sleep $POLL; elapsed=$((elapsed+POLL))
    [ $((elapsed%600)) -eq 0 ] && log "  MP#$id: $status (${elapsed}s / ${TIMEOUT}s)"
  done
  log "  MP#$id: TIMEOUT — stopping"
  curl -s -X PATCH "$API/mp-exam/stop/$id" >/dev/null 2>&1
}

wait_mm() {
  local id=$1 elapsed=0
  while [ $elapsed -lt $TIMEOUT ]; do
    status=$(curl -s "$API/mm-exam/status/$id" 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['status'])" 2>/dev/null)
    case "$status" in Completed|Error|Stopped) log "  MM#$id → $status"; return;; esac
    sleep $POLL; elapsed=$((elapsed+POLL))
    [ $((elapsed%600)) -eq 0 ] && log "  MM#$id: $status (${elapsed}s / ${TIMEOUT}s)"
  done
  log "  MM#$id: TIMEOUT — stopping"
  curl -s -X PATCH "$API/mm-exam/stop/$id" >/dev/null 2>&1
}

create_mp() {
  local name=$1 gpu=$2 bs=$3 data=$4 retry=$5 tp=${6:-1} scenario=${7:-offline}
  local started_at=$(date -u -d '+60 seconds' +%Y-%m-%dT%H:%M:%SZ)
  curl -s -X POST "$API/mp-exam/create" \
    -H "Content-Type: application/json" \
    -d "{
      \"name\":\"$name\",\"description\":\"GPU benchmark runner v2\",
      \"model\":\"Llama-3.1-8B-Instruct\",\"precision\":\"bfloat16\",\"framework\":\"vllm\",
      \"gpu_type\":\"$gpu\",\"gpu_num\":$tp,\"cpu_core\":8,\"ram_capacity\":64,
      \"batch_size\":$bs,\"dataset\":\"cnn_eval.json\",\"data_number\":$data,
      \"retry_num\":$retry,\"scenario\":\"$scenario\",\"mode\":\"performance\",
      \"tensor_parallel_size\":$tp,\"num_workers\":1,\"target_qps\":0,\"min_duration\":60,
      \"started_at\":\"$started_at\"
    }" 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['id'])" 2>/dev/null
}

create_mm() {
  local name=$1 gpu=$2 data=$3 retry=$4
  local started_at=$(date -u -d '+60 seconds' +%Y-%m-%dT%H:%M:%SZ)
  curl -s -X POST "$API/mm-exam/create" \
    -H "Content-Type: application/json" \
    -d "{
      \"name\":\"$name\",\"description\":\"GPU benchmark runner v2\",
      \"model\":\"Llama-3.1-8B-Instruct\",\"precision\":\"bfloat16\",\"framework\":\"vllm\",
      \"gpu_type\":\"$gpu\",\"gpu_num\":1,\"gpu_util\":0.8,\"cpu_core\":8,\"ram_capacity\":64,
      \"batch_size\":1,\"dataset\":\"mmlu-pro\",\"data_number\":$data,
      \"retry_num\":$retry,\"subject\":\"all\",\"n_train\":1,
      \"started_at\":\"$started_at\"
    }" 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['id'])" 2>/dev/null
}

ALL_IDS=""

# ============================================================
log "=== GPU Runner v2 Started ==="
log "PID: $$ — Kill with: kill $$"
log ""

# --- Step 1: MLPerf BS=1, 500 samples, 3 runs (baseline) ---
log "STEP 1: MLPerf BS=1, 500 samples, 3 runs"
L1=$(create_mp "MLPerf-L40-BS1-500" "NVIDIA-L40" 1 500 3)
A1=$(create_mp "MLPerf-A40-BS1-500" "NVIDIA-A40" 1 500 3)
log "  Created MP#$L1 (L40) + MP#$A1 (A40)"
ALL_IDS="$ALL_IDS $L1 $A1"
wait_mp "$L1" & wait_mp "$A1" & wait
sleep 10

# --- Step 2: MLPerf BS=4, 500 samples, 3 runs ---
log ""
log "STEP 2: MLPerf BS=4, 500 samples, 3 runs"
L2=$(create_mp "MLPerf-L40-BS4-500" "NVIDIA-L40" 4 500 3)
A2=$(create_mp "MLPerf-A40-BS4-500" "NVIDIA-A40" 4 500 3)
log "  Created MP#$L2 (L40) + MP#$A2 (A40)"
ALL_IDS="$ALL_IDS $L2 $A2"
wait_mp "$L2" & wait_mp "$A2" & wait
sleep 10

# --- Step 3: MMLU, full dataset, 1 run ---
log ""
log "STEP 3: MMLU Full, 1 run"
LM=$(create_mm "MMLU-L40-Full" "NVIDIA-L40" 0 1)
AM=$(create_mm "MMLU-A40-Full" "NVIDIA-A40" 0 1)
log "  Created MM#$LM (L40) + MM#$AM (A40)"
ALL_IDS="$ALL_IDS mm$LM mm$AM"
wait_mm "$LM" & wait_mm "$AM" & wait
sleep 10

# --- Step 4: MLPerf TP=2, 500 samples, 3 runs ---
log ""
log "STEP 4: MLPerf TP=2, 500 samples, 3 runs"
L4=$(create_mp "MLPerf-L40-TP2-500" "NVIDIA-L40" 1 500 3 2)
A4=$(create_mp "MLPerf-A40-TP2-500" "NVIDIA-A40" 1 500 3 2)
log "  Created MP#$L4 (L40) + MP#$A4 (A40)"
ALL_IDS="$ALL_IDS $L4 $A4"
wait_mp "$L4" & wait_mp "$A4" & wait
sleep 10

# --- Step 5: MLPerf BS=2, 500 samples, 3 runs ---
log ""
log "STEP 5: MLPerf BS=2, 500 samples, 3 runs"
L5=$(create_mp "MLPerf-L40-BS2-500" "NVIDIA-L40" 2 500 3)
A5=$(create_mp "MLPerf-A40-BS2-500" "NVIDIA-A40" 2 500 3)
log "  Created MP#$L5 (L40) + MP#$A5 (A40)"
ALL_IDS="$ALL_IDS $L5 $A5"
wait_mp "$L5" & wait_mp "$A5" & wait

# --- Done ---
log ""
log "=== ALL STEPS COMPLETE ==="
log "All exam IDs: $ALL_IDS"

cat > "$TRIGGER" <<EOF
{
  "triggered_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "plan": "/home/kcloud/etri-llm-exam-solution/.omc/plans/ralplan-gpu-benchmark-loop.md",
  "status": "ready"
}
EOF
log "Trigger file written. Ready for multi-agent loop."
