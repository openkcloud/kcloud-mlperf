#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
run_benchmark.sh --host-model <path> [--run-id <id>] [--tasks <list>] [--batch-size <N|auto>] [--num-fewshot <N>]

Arguments
  --host-model       (required) path INSIDE the container to the model dir (e.g., /host_models/llama3_1-8b)
  --run-id           optional run id; defaults to timestamp
  --tasks            comma-separated lm-eval tasks (default: hellaswag,arc_challenge,winogrande,boolq,piqa)
  --batch-size       eval batch size or 'auto' (default: auto)
  --num-fewshot      few-shot k (default: 0)

Environment
  MAX_TOKENS         max new tokens for generative tasks (if used by a task; default 64)
  HF_TOKEN / HUGGINGFACE_TOKEN   forwarded if you need gated models
USAGE
}

# ---------- parse args ----------
HOST_MODEL=""
RUN_ID="$(date +%Y%m%d-%H%M%S)"
TASKS="hellaswag,arc_challenge,winogrande,boolq,piqa"
BATCH="auto"
NFS=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host-model) HOST_MODEL="${2:-}"; shift 2 ;;
    --run-id)     RUN_ID="${2:-}"; shift 2 ;;
    --tasks)      TASKS="${2:-}"; shift 2 ;;
    --batch-size) BATCH="${2:-}"; shift 2 ;;
    --num-fewshot)NFS="${2:-}"; shift 2 ;;
    -h|--help)    usage; exit 0 ;;
    *) echo "[ERROR] Unknown arg: $1" >&2; usage; exit 1 ;;
  esac
done

if [[ -z "$HOST_MODEL" || ! -d "$HOST_MODEL" ]]; then
  echo "[ERROR] --host-model missing or not a directory: $HOST_MODEL" >&2
  usage; exit 1
fi

# ---------- setup ----------
RESULTS_ROOT="/app/results"
OUTDIR="${RESULTS_ROOT}/${RUN_ID}"
mkdir -p "$OUTDIR"

export HF_HOME="/app/.cache/huggingface"
mkdir -p "$HF_HOME"
export TRANSFORMERS_NO_ADVISORY_WARNINGS=1
export TOKENIZERS_PARALLELISM=false

# Pass HF token to subprocesses if present
if [[ -n "${HF_TOKEN:-}" ]]; then export HUGGINGFACE_HUB_TOKEN="$HF_TOKEN"; fi
if [[ -n "${HUGGINGFACE_TOKEN:-}" ]]; then export HUGGINGFACE_HUB_TOKEN="$HUGGINGFACE_TOKEN"; fi

# Basic GPU check
python3 - <<'PY' || { echo "[ERROR] CUDA is not available in this container."; exit 2; }
import sys
import torch
sys.exit(0 if torch.cuda.is_available() else 1)
PY

# ---------- run lm-eval ----------
echo "[INFO] Starting lm-eval"
echo "[INFO]   model: $HOST_MODEL"
echo "[INFO]   tasks: $TASKS"
echo "[INFO]   out  : $OUTDIR"

# We installed lm-eval==0.4.3 in the Dockerfile
set -x
lm_eval \
  --model hf \
  --model_args "pretrained=${HOST_MODEL},tokenizer=${HOST_MODEL},trust_remote_code=True,dtype=float16,device=cuda:0" \
  --tasks "${TASKS}" \
  --batch_size "${BATCH}" \
  --num_fewshot "${NFS}" \
  --output_path "${OUTDIR}" \
  --use_accelerate \
  --seed 1234 \
  --log_samples \
  --write_out
set +x

# lm-eval writes results to ${OUTDIR}/results.json
if [[ -f "${OUTDIR}/results.json" ]]; then
  echo "[OK] lm-eval complete -> ${OUTDIR}/results.json"
else
  echo "[WARN] results.json not found in ${OUTDIR} (lm-eval may have failed)."
fi

# Optional: try to build a simple report if the helper is available.
if [[ -f "/app/generate_report_from_json.py" && -f "${OUTDIR}/results.json" ]]; then
  echo "[INFO] Generating report..."
  # Try both common CLIs gracefully.
  if python3 /app/generate_report_from_json.py --input "${OUTDIR}/results.json" --output "${OUTDIR}/report.md"; then
    echo "[OK] Report -> ${OUTDIR}/report.md"
  elif python3 /app/generate_report_from_json.py "${OUTDIR}/results.json" "${OUTDIR}/report.md"; then
    echo "[OK] Report -> ${OUTDIR}/report.md"
  else
    echo "[WARN] Report generator ran but didn’t produce an output."
  fi
fi

echo "[INFO] Done."
