#!/bin/bash
# GPU Sequential Benchmark Runner
# Waits for each exam to complete before creating the next on the same GPU.
# L40 and A40 run in parallel (different nodes).

API="http://10.254.177.41:30980/api"
LOG="/home/kcloud/etri-llm-exam-solution/.omc/logs/gpu-sequential-runner.log"
TRIGGER="/home/kcloud/etri-llm-exam-solution/.omc/state/gpu-loop-trigger.json"
POLL=30
TIMEOUT=14400  # 4h per exam max

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG"; }

wait_exam_mp() {
  local id=$1 elapsed=0
  while [ $elapsed -lt $TIMEOUT ]; do
    status=$(curl -s "$API/mp-exam/details/$id" 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['status'])" 2>/dev/null)
    case "$status" in Completed|Error|Stopped|Undefined) log "  MP#$id: $status"; return 0;; esac
    sleep $POLL; elapsed=$((elapsed+POLL))
    [ $((elapsed%300)) -eq 0 ] && log "  MP#$id: $status (${elapsed}s elapsed)"
  done
  log "  MP#$id: TIMEOUT after ${TIMEOUT}s"
  curl -s -X PATCH "$API/mp-exam/stop/$id" >/dev/null 2>&1
  return 1
}

wait_exam_mm() {
  local id=$1 elapsed=0
  while [ $elapsed -lt $TIMEOUT ]; do
    status=$(curl -s "$API/mm-exam/details/$id" 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['status'])" 2>/dev/null)
    case "$status" in Completed|Error|Stopped|Undefined) log "  MM#$id: $status"; return 0;; esac
    sleep $POLL; elapsed=$((elapsed+POLL))
    [ $((elapsed%300)) -eq 0 ] && log "  MM#$id: $status (${elapsed}s elapsed)"
  done
  log "  MM#$id: TIMEOUT after ${TIMEOUT}s"
  curl -s -X PATCH "$API/mm-exam/stop/$id" >/dev/null 2>&1
  return 1
}

create_mp() {
  local name=$1 gpu=$2 bs=$3 data=$4 retry=$5 tp=$6 scenario=${7:-offline}
  local started_at=$(date -u -d '+30 seconds' +%Y-%m-%dT%H:%M:%S%z)
  local id=$(curl -s -X POST "$API/mp-exam/create" \
    -H "Content-Type: application/json" \
    -d "{
      \"name\":\"$name\",\"description\":\"Auto-created by sequential runner\",
      \"model\":\"Llama-3.1-8B-Instruct\",\"precision\":\"bfloat16\",\"framework\":\"vllm\",
      \"gpu_type\":\"$gpu\",\"gpu_num\":$tp,\"cpu_core\":8,\"ram_capacity\":64,
      \"batch_size\":$bs,\"dataset\":\"cnn_eval.json\",\"data_number\":$data,
      \"retry_num\":$retry,\"scenario\":\"$scenario\",\"mode\":\"performance\",
      \"tensor_parallel_size\":$tp,\"num_workers\":1,\"target_qps\":0,\"min_duration\":60,
      \"started_at\":\"$started_at\"
    }" 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['id'])" 2>/dev/null)
  echo "$id"
}

create_mm() {
  local name=$1 gpu=$2 data=$3 retry=$4
  local started_at=$(date -u -d '+30 seconds' +%Y-%m-%dT%H:%M:%S%z)
  local id=$(curl -s -X POST "$API/mm-exam/create" \
    -H "Content-Type: application/json" \
    -d "{
      \"name\":\"$name\",\"description\":\"Auto-created by sequential runner\",
      \"model\":\"Llama-3.1-8B-Instruct\",\"precision\":\"bfloat16\",\"framework\":\"vllm\",
      \"gpu_type\":\"$gpu\",\"gpu_num\":1,\"gpu_util\":0.8,\"cpu_core\":8,\"ram_capacity\":64,
      \"batch_size\":1,\"dataset\":\"mmlu-pro\",\"data_number\":$data,
      \"retry_num\":$retry,\"subject\":\"all\",\"n_train\":1,
      \"started_at\":\"$started_at\"
    }" 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['id'])" 2>/dev/null)
  echo "$id"
}

# ============================================================
log "=== GPU Sequential Runner Started ==="
log "PID: $$ — Kill with: kill $$"

# --- Step 1: Wait for #91 (L40) and #92 (A40) ---
log ""
log "STEP 1: Waiting for running exams #91 (L40) and #92 (A40)..."
wait_exam_mp 91 &
wait_exam_mp 92 &
wait

# --- Step 2: MLPerf BS=4 (L40 + A40 in parallel) ---
log ""
log "STEP 2: MLPerf BS=4, 500 samples"
L40_ID=$(create_mp "MLPerf-L40-BS4-500" "NVIDIA-L40" 4 500 3 1)
A40_ID=$(create_mp "MLPerf-A40-BS4-500" "NVIDIA-A40" 4 500 3 1)
log "  Created MP#$L40_ID (L40) and MP#$A40_ID (A40)"
wait_exam_mp "$L40_ID" &
wait_exam_mp "$A40_ID" &
wait

# --- Step 3: MMLU (L40 + A40 in parallel) ---
log ""
log "STEP 3: MMLU Full dataset"
L40_MM=$(create_mm "MMLU-L40-Full" "NVIDIA-L40" 0 1)
A40_MM=$(create_mm "MMLU-A40-Full" "NVIDIA-A40" 0 1)
log "  Created MM#$L40_MM (L40) and MM#$A40_MM (A40)"
wait_exam_mm "$L40_MM" &
wait_exam_mm "$A40_MM" &
wait

# --- Step 4: MLPerf TP=2 (L40 + A40 in parallel) ---
log ""
log "STEP 4: MLPerf TP=2 (2 GPUs), 500 samples"
L40_TP=$(create_mp "MLPerf-L40-TP2-500" "NVIDIA-L40" 1 500 3 2)
A40_TP=$(create_mp "MLPerf-A40-TP2-500" "NVIDIA-A40" 1 500 3 2)
log "  Created MP#$L40_TP (L40) and MP#$A40_TP (A40)"
wait_exam_mp "$L40_TP" &
wait_exam_mp "$A40_TP" &
wait

# --- Step 5: MLPerf BS=2 (fill the gap) ---
log ""
log "STEP 5: MLPerf BS=2, 500 samples"
L40_B2=$(create_mp "MLPerf-L40-BS2-500" "NVIDIA-L40" 2 500 3 1)
A40_B2=$(create_mp "MLPerf-A40-BS2-500" "NVIDIA-A40" 2 500 3 1)
log "  Created MP#$L40_B2 (L40) and MP#$A40_B2 (A40)"
wait_exam_mp "$L40_B2" &
wait_exam_mp "$A40_B2" &
wait

# --- Done ---
log ""
log "=== ALL GPU BENCHMARKS COMPLETE ==="
log "Exams created: #91,#92 (full BS1), BS4, MMLU, TP2, BS2"

# Write trigger file
cat > "$TRIGGER" <<EOF
{
  "triggered_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "plan": "/home/kcloud/etri-llm-exam-solution/.omc/plans/ralplan-gpu-benchmark-loop.md",
  "status": "ready",
  "note": "All GPU benchmarks complete. Ready for multi-agent improvement loop."
}
EOF
log "Trigger file written at $TRIGGER"
log "=== Runner finished ==="
