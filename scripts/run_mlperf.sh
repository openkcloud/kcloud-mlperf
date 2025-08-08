#!/usr/bin/env bash
set -euo pipefail

show_help() {
  cat <<EOF
Usage: run_mlperf.sh --run-id RUNID [--model M] [--device D] [--performance|--accuracy] [--extra-args "..."]
Defaults to FULL OFFICIAL DATASET (CNN/DailyMail 3.0.0) with accuracy evaluation.
Outputs: results/<RUN_ID>/mlperf/{raw,summary}/
EOF
}

RUN_ID=""; MODEL=""; DEVICE=""; ACCURACY="true"; EXTRA_ARGS=""
while [[ $# -gt 0 ]]; do case $1 in
  --run-id) RUN_ID="$2"; shift 2;;
  --model) MODEL="$2"; shift 2;;
  --device) DEVICE="$2"; shift 2;;
  --accuracy) ACCURACY="true"; shift 1;;
  --performance) ACCURACY="false"; shift 1;;
  --extra-args) EXTRA_ARGS="$2"; shift 2;;
  --help|-h) show_help; exit 0;;
  *) echo "Unknown arg $1"; show_help; exit 2;;
esac; done
[[ -n "$RUN_ID" ]] || { echo "Missing --run-id"; exit 2; }

OUT="results/${RUN_ID}/mlperf"
mkdir -p "${OUT}/raw" "${OUT}/summary"
ln -sfn "results/${RUN_ID}" results/latest || true

started_at=$(date -Iseconds)
gpu_name=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1 || echo "")
driver=$(nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>/dev/null | head -1 || echo "")
cuda=$(nvcc --version 2>/dev/null | awk '/release/{print $6}' | sed 's/,//' || echo "")

# Ensure FULL OFFICIAL DATASET (CNN/DailyMail 3.0.0) is present in cache
echo "[INFO] Prefetching CNN/DailyMail 3.0.0 validation split (if not cached) ..." | tee -a "${OUT}/raw/stdout.log"
python3 - <<'PY' >> "${OUT}/raw/stdout.log" 2>&1 || true
import os
from datasets import load_dataset
from datetime import datetime
print(f"[{datetime.utcnow().isoformat()}Z] Start dataset prefetch")
ds = load_dataset("cnn_dailymail", "3.0.0", split="validation")
print(f"[{datetime.utcnow().isoformat()}Z] Prefetch done. Samples: {len(ds)}")
PY

# Compose mlcr command (official)
base_cmd="mlcr run,accuracy,mlperf,_cnndm_llama_3,_datacenter"
[[ "$ACCURACY" == "true" ]] || base_cmd="mlcr run,mlperf,_cnndm_llama_3,_datacenter,_performance"

set +e
(
  set -x
  echo "Model: ${MODEL:-from config}, Device: ${DEVICE:-from config}"
  echo "Running: $base_cmd ..."
  echo "" | $base_cmd \
    --model="${MODEL:-llama3_1-8b}" \
    --implementation=reference \
    --framework=vllm \
    --precision=float16 \
    --device=cuda \
    --gpu_memory_utilization=0.95 \
    --max_model_len=8192 \
    --max_num_batched_tokens=8192 \
    --max_num_seqs=256 \
    ${EXTRA_ARGS}
) > "${OUT}/raw/stdout.log" 2>&1
rc=$?
set -e

# Minimal parsing (best-effort)
accuracy=null; latency_ms=null; notes=""
if grep -qi "rouge" "${OUT}/raw/stdout.log"; then
  notes="MLPerf run completed; see raw/stdout.log for official ROUGE."
fi

ended_at=$(date -Iseconds)
jq -n \
  --arg task "mlperf" \
  --arg run_id "$RUN_ID" \
  --arg started_at "$started_at" \
  --arg ended_at "$ended_at" \
  --arg status "$([ $rc -eq 0 ] && echo ok || echo error)" \
  --arg gpu_name "$gpu_name" \
  --arg driver "$driver" \
  --arg cuda "$cuda" \
  --arg notes "$notes" \
  '{
    task: $task,
    run_id: $run_id,
    started_at: $started_at,
    ended_at: $ended_at,
    status: $status,
    metrics: {accuracy: null, latency_ms: null, notes: $notes},
    device: {gpu_name: $gpu_name, driver: $driver, cuda: $cuda},
    artifacts: ["raw/stdout.log"]
  }' > "${OUT}/summary/summary.json"

exit "$rc"

