#!/usr/bin/env bash
set -euo pipefail

show_help() {
  cat <<EOF
Usage: run_mmlu.sh --run-id RUNID [--model M] [--device D] [--shots N] [--extra-args "..."]
Outputs: results/<RUN_ID>/mmlu/{raw,summary}/ and summary/mmlu_breakdown.csv
EOF
}

RUN_ID=""; MODEL="meta-llama/Llama-3.1-8B-Instruct"; DEVICE=""; SHOTS="5"; EXTRA_ARGS=""
while [[ $# -gt 0 ]]; do case $1 in
  --run-id) RUN_ID="$2"; shift 2;;
  --model) MODEL="$2"; shift 2;;
  --device) DEVICE="$2"; shift 2;;
  --shots) SHOTS="$2"; shift 2;;
  --extra-args) EXTRA_ARGS="$2"; shift 2;;
  --help|-h) show_help; exit 0;;
  *) echo "Unknown arg $1"; show_help; exit 2;;
esac; done
[[ -n "$RUN_ID" ]] || { echo "Missing --run-id"; exit 2; }

OUT="results/${RUN_ID}/mmlu"
mkdir -p "${OUT}/raw" "${OUT}/summary"
ln -sfn "results/${RUN_ID}" results/latest || true

started_at=$(date -Iseconds)
gpu_name=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1 || echo "")
driver=$(nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>/dev/null | head -1 || echo "")
cuda=$(nvcc --version 2>/dev/null | awk '/release/{print $6}' | sed 's/,//' || echo "")

set +e
if [[ -f "llm_eval/evaluate_official_mmlu.py" ]]; then
  (
    set -x
    # Attempt full MMLU using HF dataset (cais/mmlu). Results JSON saved for parsing.
    python3 llm_eval/evaluate_official_mmlu.py \
      --model "${MODEL}" \
      --dataset "cais/mmlu" \
      --batch_size 8 \
      --output "${OUT}/summary/mmlu_results.json" \
      ${EXTRA_ARGS}
  ) > "${OUT}/raw/mmlu_eval.log" 2>&1
  rc=$?
else
  echo "MMLU script not found; skipping" > "${OUT}/raw/mmlu_eval.log"
  rc=1
fi
set -e

# Parse accuracy from JSON if available, fallback to log-grep
accuracy=null
if [[ -f "${OUT}/summary/mmlu_results.json" ]]; then
  acc_val=$(jq -r '.accuracy // empty' "${OUT}/summary/mmlu_results.json" 2>/dev/null || true)
  if [[ -n "${acc_val}" ]]; then accuracy="$acc_val"; fi
fi
if [[ "$accuracy" == "null" ]]; then
  overall_acc=$(grep -Eo "overall accuracy[:=]\\s*[0-9.]+%" "${OUT}/raw/mmlu_eval.log" | grep -Eo "[0-9.]+%" | head -1 || true)
  [[ -n "${overall_acc}" ]] && accuracy="${overall_acc%%%}"
fi

grep -E "^[^,]+,[0-9.]+$" "${OUT}/raw/mmlu_eval.log" | head -200 > "${OUT}/summary/mmlu_breakdown.csv" || true

ended_at=$(date -Iseconds)
jq -n \
  --arg task "mmlu" \
  --arg run_id "$RUN_ID" \
  --arg started_at "$started_at" \
  --arg ended_at "$ended_at" \
  --arg status "$([ $rc -eq 0 ] && echo ok || echo error)" \
  --arg gpu_name "$gpu_name" \
  --arg driver "$driver" \
  --arg cuda "$cuda" \
  --argjson accuracy "$([[ "$accuracy" == "null" ]] && echo null || echo "$accuracy")" \
  '{
    task: $task,
    run_id: $run_id,
    started_at: $started_at,
    ended_at: $ended_at,
    status: $status,
    metrics: {accuracy: ( $accuracy ), latency_ms: null, notes: "" },
    device: {gpu_name: $gpu_name, driver: $driver, cuda: $cuda},
    artifacts: ["raw/mmlu_eval.log","summary/mmlu_breakdown.csv"]
  }' > "${OUT}/summary/summary.json"

exit "$rc"

