#!/usr/bin/env bash
set -Eeuo pipefail

############################################################
# run_llama31_8b_only.sh
# - MLPerf Inference v5.1 (Server/Offline) on LLaMA-3.1-8B via vLLM
# - Only LLM summarization (CNN/DailyMail) dataset
############################################################

log()  { printf '[INFO] %s\n' "$*"; }
warn() { printf '[WARN] %s\n' "$*" >&2; }
err()  { printf '[ERROR] %s\n' "$*" >&2; }
elapsed() { local s="$1" n; n="$(date +%s)"; printf "%02dh:%02dm:%02ds" $(((n-s)/3600)) $((((n-s)%3600)/60)) $(((n-s)%60)); }

# ---------- layout / defaults ----------
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_ID="$(date +%Y%m%d-%H%M%S)"
RESULTS_DIR="${ROOT_DIR}/results/${RUN_ID}"
LOG_DIR="${RESULTS_DIR}/logs"
MLC_WS="${RESULTS_DIR}/mlc_workspace"
mkdir -p "${RESULTS_DIR}" "${LOG_DIR}" "${MLC_WS}"

# Load .env (safe)
if [[ -f "${ROOT_DIR}/.env" ]]; then
  set -o allexport
  # shellcheck disable=SC1090
  . "${ROOT_DIR}/.env"
  set +o allexport
fi

# ---------- knobs ----------
: "${MODEL_ID:=meta-llama/Meta-Llama-3.1-8B-Instruct}"
: "${AUTOMATIONS_REPO:=mlcommons@mlperf-automations}"
: "${AUTOMATIONS_BRANCH_PRIMARY:=inference-v5.1}"
: "${AUTOMATIONS_BRANCH_FALLBACK:=dev}"

: "${MLPERF_SUT_NAME:=local_vllm}"
: "${MLPERF_SYSTEM_DESC:=local_single_node}"
: "${MLPERF_RUN_ACCURACY:=1}"          # 0=perf only; 1=also accuracy
: "${SERVER_TARGET_QPS:=4}"
: "${OFFLINE_TARGET_QPS:=6}"
: "${MAX_NEW_TOKENS:=128}"
: "${BATCH_SIZE_HINT:=8}"
: "${MLPERF_TIMEOUT_SECS:=5400}"       # 90m safety timeout

# Try these tags first to select the LLM vLLM app.
# If your checkout uses different tags, override:  APP_TAGS="app,mlperf,inference,llama3_1,vllm"
if [[ -z "${APP_TAGS:-}" ]]; then
  # auto-discover an LLM app in your checkout
  CANDIDATES=(
    "app,mlperf,inference,llama3"
    "app,mlperf,inference,llama3,reference"
    "app,mlcommons,mlperf,inference,llama3"
    "app,mlperf,inference,reference"
  )
  for t in "${CANDIDATES[@]}"; do
    if mlc list scripts --tags="${t}" >/dev/null 2>&1; then
      APP_TAGS="${t}"
      echo "[INFO] Auto-selected APP_TAGS=${APP_TAGS}"
      break
    fi
  done
  if [[ -z "${APP_TAGS:-}" ]]; then
    echo "[ERROR] Couldn’t find an LLM app. Show me this output:" >&2
    echo "mlc list scripts --tags=app,mlperf,inference --print=name,tags" >&2
    exit 1
  fi
fi

# HF cache/accel
: "${HF_HOME:=${ROOT_DIR}/.hf_cache}"
: "${HUGGINGFACE_HUB_CACHE:=${HF_HOME}}"
: "${HF_HUB_ENABLE_HF_TRANSFER:=1}"
export HF_HOME HUGGINGFACE_HUB_CACHE HF_HUB_ENABLE_HF_TRANSFER
mkdir -p "${HF_HOME}"

# live log knobs
: "${LIVE_LOG:=1}"
: "${HEARTBEAT_INTERVAL:=10}"

log "RUN_ID=${RUN_ID}"
log "Results directory: ${RESULTS_DIR}"
log "Hugging Face cache: ${HF_HOME}"

# ---------- sanity ----------
command -v python3 >/dev/null || { err "python3 not found"; exit 1; }
command -v mlc >/dev/null || { err "mlc not found. Install:  python3 -m pip install --user mlcflow"; exit 1; }

# ensure small HF helpers for prefetch
python3 - <<'PY' >/dev/null 2>&1 || true
import sys, subprocess
def ensure(spec):
    try: __import__(spec.split(">=")[0])
    except Exception: subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "--user", spec])
for pkg in ("huggingface_hub>=0.23", "hf_transfer>=0.1.6", "tqdm"):
    ensure(pkg)
PY

DEVICE="cuda"
if ! command -v nvidia-smi >/dev/null 2>&1; then
  warn "NVIDIA driver not detected; falling back to CPU (slow)."
  DEVICE="cpu"
fi
log "Device detected/selected: ${DEVICE}"

# ---------- utilities ----------
_watch_cache() {
  local lbl="${1:-Working}"
  while :; do
    local size ts
    size="$(du -sh "${HF_HOME}" 2>/dev/null | awk '{print $1}')" || size="0"
    ts="$(date +%H:%M:%S)"
    printf '[INFO] %s %s (HF cache: %s)\n' "${ts}" "${lbl}" "${size:-0}"
    sleep "${HEARTBEAT_INTERVAL}"
  done
}

run_with_live_log() {
  # usage: run_with_live_log "<label>" "<logfile>" <cmd...>
  local label="$1"; shift
  local logfile="$1"; shift
  mkdir -p "$(dirname "${logfile}")"
  local start_ts hb_pid rc
  start_ts="$(date +%s)"
  log "${label} (first run can be long; downloads GBs if uncached)"

  if [[ "${LIVE_LOG}" == "1" ]]; then _watch_cache "${label}…" & hb_pid=$!; else hb_pid=""; fi

  set +e
  (stdbuf -oL -eL "$@") |& tee -a "${logfile}"
  rc=${PIPESTATUS[0]}
  set -e

  if [[ -n "${hb_pid}" ]]; then kill "${hb_pid}" >/dev/null 2>&1 || true; wait "${hb_pid}" 2>/dev/null || true; fi

  if [[ ${rc} -ne 0 ]]; then err "${label} FAILED after $(elapsed "${start_ts}"). See ${logfile}"
  else log "${label} done in $(elapsed "${start_ts}")."; fi
  return ${rc}
}

# ---------- 0) HF auth + model prefetch ----------
if [[ -z "${HF_TOKEN:-}" && -z "${HUGGINGFACE_TOKEN:-}" ]]; then
  err "HF_TOKEN is not set (needed for gated model ${MODEL_ID}). Put it in .env as: HF_TOKEN=hf_xxx"
  exit 1
fi
export HUGGINGFACE_TOKEN="${HUGGINGFACE_TOKEN:-${HF_TOKEN}}"

log "Prefetching ${MODEL_ID} to local HF cache"
LLAMA3_CHECKPOINT_PATH="$(MODEL_ID="${MODEL_ID}" python3 - <<'PY'
import os
from huggingface_hub import snapshot_download
mid=os.environ["MODEL_ID"]
tok=os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")
p=snapshot_download(mid, token=tok)
print(p, end="")
PY
)"
[[ -n "${LLAMA3_CHECKPOINT_PATH}" ]] || { err "snapshot_download returned empty path."; exit 1; }
export LLAMA3_CHECKPOINT_PATH
log "Model path: ${LLAMA3_CHECKPOINT_PATH}"

# ---------- 1) Pull mlperf-automations ----------
pull_branch() {
  local branch="$1"
  run_with_live_log \
    "Pulling MLPerf automations (${AUTOMATIONS_REPO}) branch=${branch}" \
    "${LOG_DIR}/mlc_pull_${branch}.log" \
    mlc pull repo "${AUTOMATIONS_REPO}" --branch="${branch}" -v
}
if ! pull_branch "${AUTOMATIONS_BRANCH_PRIMARY}"; then
  warn "Falling back to ${AUTOMATIONS_BRANCH_FALLBACK}…"
  pull_branch "${AUTOMATIONS_BRANCH_FALLBACK}" || { err "Could not pull mlperf-automations."; exit 1; }
fi

# ---------- 2) Fetch MLPerf LLaMA3 dataset (CNN/DailyMail) ----------
DATASET_CMD=(bash -lc "printf 'n\n' | mlc run script \
  --tags=get,dataset,mlperf,llama3,inference \
  --env.HF_TOKEN='${HF_TOKEN:-}' \
  --env.HUGGINGFACE_TOKEN='${HUGGINGFACE_TOKEN:-}' \
  --env.MLC_OUTDIRNAME='llama3_mlperf_dataset' -v")

if ! run_with_live_log "Fetching MLPerf LLaMA3 dataset" "${LOG_DIR}/get_dataset.log" "${DATASET_CMD[@]}"; then
  err "Dataset fetch failed. See ${LOG_DIR}/get_dataset.log"
  exit 1
fi

DATASET_PATH="$(sed -n 's/.*Path to the dataset:[[:space:]]*//p' "${LOG_DIR}/get_dataset.log" | tail -n 1)"
[[ -n "${DATASET_PATH}" ]] || { err "Could not parse dataset path from log. See ${LOG_DIR}/get_dataset.log"; exit 1; }
export MLC_DATASET_LLAMA3_PATH="${DATASET_PATH}"
log "Dataset path: ${MLC_DATASET_LLAMA3_PATH}"

# Make wget more snappy with flaky mirrors
WGETRC_FILE="${RESULTS_DIR}/wgetrc"
cat > "${WGETRC_FILE}" <<'EOF'
timeout = 12
connect_timeout = 5
dns_timeout = 5
read_timeout = 10
EOF
export WGETRC="${WGETRC_FILE}"

# ---------- 3) MLPerf Inference runs (LLM/vLLM only) ----------
run_mlperf_case() {
  local scenario="$1"   # Server | Offline
  local mode="$2"       # performance | accuracy
  local outdir="${RESULTS_DIR}/mlperf/${scenario,,}_${mode}"
  mkdir -p "${outdir}"

  # NOTE: These envs are consumed by the LLM/vLLM app in mlperf-automations.
  # If your checkout uses different tags for the LLM app, override APP_TAGS.
  local CMD=(bash -lc "yes '' | mlc run script \
    --tags=${APP_TAGS} \
    --env.BACKEND='vllm' \
    --env.SCENARIO='${scenario}' \
    --env.MODE='${mode}' \
    --env.SUT_NAME='${MLPERF_SUT_NAME}' \
    --env.SYSTEM_DESC='${MLPERF_SYSTEM_DESC}' \
    --env.LLAMA3_CHECKPOINT_PATH='${LLAMA3_CHECKPOINT_PATH}' \
    --env.MLC_DATASET_LLAMA3_PATH='${MLC_DATASET_LLAMA3_PATH}' \
    --env.MAX_NEW_TOKENS='${MAX_NEW_TOKENS}' \
    --env.BATCH_SIZE_HINT='${BATCH_SIZE_HINT}' \
    --env.SERVER_TARGET_QPS='${SERVER_TARGET_QPS}' \
    --env.OFFLINE_TARGET_QPS='${OFFLINE_TARGET_QPS}' \
    --env.OUTPUT_DIR='${outdir}' -v")

  if command -v timeout >/dev/null 2>&1; then
    run_with_live_log "Starting MLPerf ${scenario} (${mode}) with vLLM" "${outdir}/run.log" \
      timeout --preserve-status -k 15s "${MLPERF_TIMEOUT_SECS}" "${CMD[@]}"
  else
    run_with_live_log "Starting MLPerf ${scenario} (${mode}) with vLLM" "${outdir}/run.log" "${CMD[@]}"
  fi
}

# Performance runs
run_mlperf_case "Server"  "performance" || true
run_mlperf_case "Offline" "performance" || true

# Accuracy runs (optional)
if [[ "${MLPERF_RUN_ACCURACY}" == "1" ]]; then
  run_mlperf_case "Server"  "accuracy" || true
  run_mlperf_case "Offline" "accuracy" || true
fi

# ---------- 4) Final pointers ----------
log "Done."
log "Artifacts:"
log "  Model:   ${LLAMA3_CHECKPOINT_PATH}"
log "  Dataset: ${MLC_DATASET_LLAMA3_PATH}"
log "  MLPerf:  ${RESULTS_DIR}/mlperf"
