#!/usr/bin/env bash
# /usr/local/bin/mlbench
set -Eeuo pipefail

SUBCMD="${1:-}"; shift || true
RUN_ID="${RUN_ID:-${1:-}}"; [[ "${RUN_ID:-}" == "--run-id" ]] && { shift; RUN_ID="${1:-}"; shift || true; }
RUN_ID="${RUN_ID:-$(date +%Y%m%d-%H%M%S)}"

RESULTS_DIR="/app/results/${RUN_ID}"
CACHE_DIR="/app/.cache"
mkdir -p "$RESULTS_DIR" "$CACHE_DIR"

# Cache dirs
export HF_HOME="$CACHE_DIR/huggingface"
export HUGGINGFACE_HUB_CACHE="$CACHE_DIR/huggingface"
export TRANSFORMERS_CACHE="$CACHE_DIR/huggingface"
export HF_DATASETS_CACHE="$CACHE_DIR/huggingface/datasets"

# 👉 Tell mlcr which python to use (avoid interactive prompt)
export CM_PYTHON_BIN_WITH_PATH=/opt/conda/bin/python3
export CM_PYTHON_BIN=/opt/conda/bin/python3
export CM_PYTHON=/opt/conda/bin/python3

log(){ echo "[mlbench][$SUBCMD] $*"; }

case "$SUBCMD" in
  mlperf)
    log "RUN_ID=${RUN_ID}"
    log "Starting MLPerf accuracy (Llama 3.1 8B → CNNDM datacenter spec)"

    # 👉 Feed newlines so any mlcr prompt auto-selects default
    set -x
    yes "" | mlcr run,accuracy,mlperf,_cnndm_llama_3,_datacenter \
      --model=llama3_1-8b \
      --implementation=reference \
      --framework=vllm \
      --precision=float16 \
      --device=cuda \
      --gpu_memory_utilization=0.95 \
      --max_model_len=8192 \
      --max_num_batched_tokens=8192 \
      --max_num_seqs=256 \
      | tee "${RESULTS_DIR}/mlperf_accuracy.log"
    set +x

    log "MLPerf accuracy finished. Log → ${RESULTS_DIR}/mlperf_accuracy.log"
    ;;

  mmlu)
    SHOTS="${SHOTS:-5}"
    log "RUN_ID=${RUN_ID}  SHOTS=${SHOTS}"
    log "Running MMLU with lm-eval (hf-causal, fp16)"

    OUT_DIR="${RESULTS_DIR}/mmlu"
    mkdir -p "$OUT_DIR"

    set -x
    lm_eval \
      --model hf-causal \
      --model_args "pretrained=meta-llama/Llama-3.1-8B-Instruct,revision=main,dtype=float16,device_map=auto,trust_remote_code=true" \
      --tasks "hendrycksTest-*" \
      --num_fewshot "${SHOTS}" \
      --batch_size auto \
      --output_path "${OUT_DIR}" \
      | tee "${OUT_DIR}/mmlu.log"
    set +x

    log "MMLU finished. Outputs → ${OUT_DIR}"
    ;;

  report)
    log "RUN_ID=${RUN_ID}"
    if [[ -f /app/report_generator.py ]]; then
      python /app/report_generator.py --run-id "${RUN_ID}" --results-root /app/results | tee "${RESULTS_DIR}/report.log"
    elif [[ -f /app/generate_report_from_json.py ]]; then
      python /app/generate_report_from_json.py --run-id "${RUN_ID}" --results-root /app/results | tee "${RESULTS_DIR}/report.log"
    else
      log "No report script found. Skipping."
      exit 2
    fi
    log "Report done. See ${RESULTS_DIR}"
    ;;

  ""|-h|--help|help)
    cat <<EOF
Usage:
  mlbench mlperf [--run-id RUN_ID]
  mlbench mmlu   [--run-id RUN_ID]
  mlbench report [--run-id RUN_ID]

Env:
  RUN_ID  ID to namespace outputs (default: timestamp)
  SHOTS   few-shot k for MMLU (default: 5)
EOF
    ;;

  *)
    echo "[ERROR] Unknown subcommand: ${SUBCMD}" >&2
    exit 2
    ;;
esac
