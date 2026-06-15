#!/usr/bin/env bash
# Entrypoint mirrors the canonical vllm-rbln cmdline captured from node5
# PID 3794752 on 2026-05-12.  The only delta vs the manual bypass:
#   * Listen on 8000 instead of 30093 (Service exposes 8000).
#   * MODEL_PATH overridable via env var (default points at the in-pod
#     hostPath mount of /mnt/models/atom_quant_bench/Llama-3.1-8B-Instruct-rbln-fp32-tp2-dev01).
#   * Honour SERVED_MODEL_NAME so the same image can serve other compiled
#     Atom+ models without rebuilding.
set -euo pipefail

MODEL_PATH="${MODEL_PATH:-/models/llama3.1-8b-rbln}"
SERVED_MODEL_NAME="${SERVED_MODEL_NAME:-rebellions/Llama-3.1-8B-Instruct}"
MAX_NUM_SEQS="${MAX_NUM_SEQS:-1}"
MAX_NUM_BATCHED_TOKENS="${MAX_NUM_BATCHED_TOKENS:-8192}"
MAX_MODEL_LEN="${MAX_MODEL_LEN:-8192}"
BLOCK_SIZE="${BLOCK_SIZE:-8192}"
PORT="${PORT:-8000}"
HOST="${HOST:-0.0.0.0}"

if [[ ! -d "$MODEL_PATH" ]]; then
  echo "[entrypoint] FATAL: MODEL_PATH=$MODEL_PATH does not exist inside the pod." >&2
  echo "[entrypoint] Did the hostPath/PVC mount of the compiled rbln model fail?" >&2
  exit 64
fi
if [[ ! -f "$MODEL_PATH/prefill.rbln" ]]; then
  echo "[entrypoint] FATAL: $MODEL_PATH/prefill.rbln missing — model not compiled or wrong dir." >&2
  exit 65
fi

echo "[entrypoint] starting vllm-rbln serve"
echo "[entrypoint]   MODEL_PATH=$MODEL_PATH"
echo "[entrypoint]   SERVED_MODEL_NAME=$SERVED_MODEL_NAME"
echo "[entrypoint]   PORT=$PORT HOST=$HOST"

exec vllm serve "$MODEL_PATH" \
  --max-num-seqs "$MAX_NUM_SEQS" \
  --max-num-batched-tokens "$MAX_NUM_BATCHED_TOKENS" \
  --max-model-len "$MAX_MODEL_LEN" \
  --block-size "$BLOCK_SIZE" \
  --port "$PORT" \
  --host "$HOST" \
  --served-model-name "$SERVED_MODEL_NAME"
