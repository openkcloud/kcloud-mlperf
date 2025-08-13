#!/usr/bin/env bash
set -Eeuo pipefail

# All-in-one: MLPerf(Server perf→report, Server acc→report, Offline perf→report, Offline acc→report), then MMLU→report

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="${ROOT_DIR}/inference-master/language/llama3.1-8b"
RUN_ID="${RUN_ID:-$(date +%Y%m%d-%H%M%S)}"
RESULTS_DIR="${ROOT_DIR}/results/${RUN_ID}"
LOG_DIR="${RESULTS_DIR}/logs"
MLPERF_DIR="${RESULTS_DIR}/mlperf"
MMLU_DIR="${RESULTS_DIR}/mmlu"
mkdir -p "${RESULTS_DIR}" "${LOG_DIR}" "${MLPERF_DIR}" "${MMLU_DIR}" "${ROOT_DIR}/.hf_cache"

# Logging helpers
TS() { date '+%Y-%m-%d %H:%M:%S'; }
log(){ printf "[%s] [INFO] %s\n" "$(TS)" "$*" | tee -a "${LOG_DIR}/run_all.log"; }
err(){ printf "[%s] [ERROR] %s\n" "$(TS)" "$*" | tee -a "${LOG_DIR}/run_all.log" >&2; }

# Flags (independent toggles and verbosity)
RUN_PERF_SERVER=1
RUN_ACC_SERVER=1
RUN_PERF_OFFLINE=1
RUN_ACC_OFFLINE=1
RUN_MMLU=1
VERBOSE=0
FULL_SAMPLES="${FULL_SAMPLES:-13368}"
USER_CONF_OVERRIDE="${USER_CONF_OVERRIDE:-user.conf}"

usage(){ cat <<USAGE
Usage: $(basename "$0") [options]
  --server-perf [0|1]     Run Server performance (default 1)
  --server-acc  [0|1]     Run Server accuracy (default 1)
  --offline-perf [0|1]    Run Offline performance (default 1)
  --offline-acc  [0|1]    Run Offline accuracy (default 1)
  --mmlu         [0|1]    Run MMLU (default 1)
  --samples N             Total-sample-count for MLPerf runs (default 13368)
  --user-conf PATH        LoadGen user.conf (default user.conf)
  --verbose               Enable set -x and more progress logs
  --help                  Show this help
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --server-perf)   RUN_PERF_SERVER="${2:-1}"; shift 2;;
    --server-acc)    RUN_ACC_SERVER="${2:-1}"; shift 2;;
    --offline-perf)  RUN_PERF_OFFLINE="${2:-1}"; shift 2;;
    --offline-acc)   RUN_ACC_OFFLINE="${2:-1}"; shift 2;;
    --mmlu)          RUN_MMLU="${2:-1}"; shift 2;;
    --samples)       FULL_SAMPLES="${2}"; shift 2;;
    --user-conf)     USER_CONF_OVERRIDE="${2}"; shift 2;;
    --verbose)       VERBOSE=1; shift;;
    --help|-h)       usage; exit 0;;
    *) err "Unknown arg: $1"; usage; exit 2;;
  esac
done

[[ "${VERBOSE}" == "1" ]] && set -x

# Load tokens
if [[ -f "${ROOT_DIR}/.env" ]]; then set -o allexport; . "${ROOT_DIR}/.env"; set +o allexport; fi
if [[ -n "${HUGGINGFACE_TOKEN:-}" ]]; then export HUGGINGFACE_HUB_TOKEN="${HUGGINGFACE_TOKEN}"; fi
if [[ -n "${HF_TOKEN:-}" ]]; then export HUGGINGFACE_HUB_TOKEN="${HF_TOKEN}"; fi

MODEL_ID="${MODEL_ID:-meta-llama/Meta-Llama-3.1-8B-Instruct}"
DTYPE="${DTYPE:-bfloat16}"
GPU_COUNT="$(nvidia-smi --list-gpus 2>/dev/null | wc -l | awk '{print $1}')"; GPU_COUNT=${GPU_COUNT:-1}

# vLLM defaults (same pipeline as smoke; larger samples by default)
export VLLM_MAX_MODEL_LEN="${MAX_LEN_USER:-4096}"
export VLLM_GPU_MEM_UTILIZATION="${GPU_MEM_UTIL:-0.95}"
export VLLM_KV_CACHE_DTYPE="${KV_CACHE_DTYPE:-auto}"
export PYTORCH_CUDA_ALLOC_CONF="${PYTORCH_CUDA_ALLOC_CONF:-expandable_segments:True}"
export VLLM_ENFORCE_EAGER="${VLLM_ENFORCE_EAGER:-1}"
export HF_HOME="${HF_HOME:-${ROOT_DIR}/.hf_cache}"
export HUGGINGFACE_HUB_CACHE="${HUGGINGFACE_HUB_CACHE:-${HF_HOME}}"

log "RUN_ID=${RUN_ID} | Results=${RESULTS_DIR} | HF_HOME=${HF_HOME}"

# Resolve model snapshot; download if missing
CHECKPOINT_PATH=$(HF_HOME="${HF_HOME}" MODEL_ID="${MODEL_ID}" python3 - <<'PY'
import os,glob; r=os.environ.get("HF_HOME","."); m=os.environ["MODEL_ID"].replace('/','--')
c=sorted(glob.glob(os.path.join(r,f"models--{m}","snapshots","*")),key=os.path.getmtime,reverse=True)
print(c[0] if c else "")
PY
)
if [[ -z "$CHECKPOINT_PATH" ]]; then
  log "Model not in cache. Downloading ${MODEL_ID} into ${HF_HOME}..."
  if [[ -z "${HUGGINGFACE_HUB_TOKEN:-}${HF_TOKEN:-}${HUGGINGFACE_TOKEN:-}" ]]; then
    err "Missing HF token. Set HUGGINGFACE_TOKEN in .env"; exit 2;
  fi
  python3 - <<'PY'
import os, sys, subprocess
try:
    from huggingface_hub import snapshot_download
except Exception:
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', '-q', 'huggingface_hub'])
    from huggingface_hub import snapshot_download
repo_id = os.environ.get('MODEL_ID')
cache_dir = os.environ.get('HF_HOME', './.hf_cache')
token = os.environ.get('HUGGINGFACE_HUB_TOKEN') or os.environ.get('HF_TOKEN') or os.environ.get('HUGGINGFACE_TOKEN')
snapshot_download(repo_id=repo_id, cache_dir=cache_dir, token=token)
PY
  CHECKPOINT_PATH=$(HF_HOME="${HF_HOME}" MODEL_ID="${MODEL_ID}" python3 - <<'PY'
import os,glob; r=os.environ.get("HF_HOME","."); m=os.environ["MODEL_ID"].replace('/','--')
c=sorted(glob.glob(os.path.join(r,f"models--{m}","snapshots","*")),key=os.path.getmtime,reverse=True)
print(c[0] if c else "")
PY
)
  [[ -z "$CHECKPOINT_PATH" ]] && { err "Model download failed or not found"; exit 2; }
fi
log "Model path: ${CHECKPOINT_PATH}"

# Dataset
DATASET_PATH="${RESULTS_DIR}/data/cnn_eval.json"; mkdir -p "${RESULTS_DIR}/data"
if [[ ! -s "$DATASET_PATH" ]]; then
  log "Generating CNN/DM eval set..."
  (cd "$APP_DIR" && python3 download_cnndm.py --model-id "$MODEL_ID") > "$LOG_DIR/build_cnndm.log" 2>&1 || exit 2
  mv "$APP_DIR/data/cnn_eval.json" "$DATASET_PATH"; rm -rf "$APP_DIR/data"
fi

run_ref(){
  local scenario="$1"; local mode="$2"; local outdir="$3"; shift 3
  mkdir -p "$outdir"
  log "${scenario} ${mode} → $outdir"
  (
    cd "$APP_DIR"
    VLLM_MAX_MODEL_LEN="${VLLM_MAX_MODEL_LEN}" \
    VLLM_GPU_MEM_UTILIZATION="${VLLM_GPU_MEM_UTILIZATION}" \
    VLLM_KV_CACHE_DTYPE="${VLLM_KV_CACHE_DTYPE}" \
    VLLM_ENFORCE_EAGER="${VLLM_ENFORCE_EAGER}" \
    VLLM_MAX_NUM_BATCHED_TOKENS="${VLLM_MAX_NUM_BATCHED_TOKENS:-4096}" \
    VLLM_MAX_NUM_SEQS="${VLLM_MAX_NUM_SEQS:-64}" \
    python -u main.py \
      --scenario "$scenario" \
      --model-path "$CHECKPOINT_PATH" \
      --batch-size 16 \
      $([[ "$mode" == "accuracy" ]] && echo "--accuracy") \
      --dtype "$DTYPE" \
      --user-conf "${USER_CONF_OVERRIDE}" \
      --total-sample-count "${FULL_SAMPLES}" \
      --dataset-path "$DATASET_PATH" \
      --output-log-dir "$outdir" \
      --tensor-parallel-size "$GPU_COUNT" \
      --num-workers "${SERVER_WORKERS:-8}" \
      --vllm "$@"
  ) |& tee -a "$outdir/run.log"
}

generate_report_for_dir(){
  local outdir="$1"
  local prefer_json=""
  if [[ -f "${outdir}/mlperf_log_summary.json" ]]; then
    prefer_json="${outdir}/mlperf_log_summary.json"
  elif [[ -f "${outdir}/mlperf_log_accuracy.json" ]]; then
    prefer_json="${outdir}/mlperf_log_accuracy.json"
  else
    prefer_json="$(ls -1t "${outdir}"/*.json 2>/dev/null | head -1)"
  fi
  if [[ -n "${prefer_json}" ]]; then
    log "Generating report for ${outdir}"
    python3 generate_report_from_json.py "${prefer_json}" |& tee -a "${outdir}/report.log" || true
  fi
}

if [[ "${RUN_PERF_SERVER}" == "1" ]]; then out_srv_perf="${MLPERF_DIR}/server_performance"; run_ref Server performance "${out_srv_perf}"; generate_report_for_dir "${out_srv_perf}"; fi
if [[ "${RUN_ACC_SERVER}"  == "1" ]]; then out_srv_acc="${MLPERF_DIR}/server_accuracy";   run_ref Server accuracy   "${out_srv_acc}";   generate_report_for_dir "${out_srv_acc}"; fi
if [[ "${RUN_PERF_OFFLINE}"== "1" ]]; then out_off_perf="${MLPERF_DIR}/offline_performance"; run_ref Offline performance "${out_off_perf}"; generate_report_for_dir "${out_off_perf}"; fi
if [[ "${RUN_ACC_OFFLINE}" == "1" ]]; then out_off_acc="${MLPERF_DIR}/offline_accuracy";   run_ref Offline accuracy   "${out_off_acc}";   generate_report_for_dir "${out_off_acc}"; fi

if [[ "${RUN_MMLU}" == "1" ]]; then
  log "MMLU run..."
  python3 -m lm_eval --model vllm \
    --model_args "pretrained=${CHECKPOINT_PATH},dtype=${DTYPE},tensor_parallel_size=${GPU_COUNT},gpu_memory_utilization=${GPU_MEM_UTIL:-0.95},max_model_len=2048,max_num_batched_tokens=2048,max_num_seqs=4,enforce_eager=True,trust_remote_code=True" \
    --tasks "${MMLU_TASKS:-mmlu}" --batch_size 2 --num_fewshot 5 \
    --output_path "${MMLU_DIR}" --log_samples |& tee -a "${MMLU_DIR}/lm_eval.log" || true
  mmlu_json="$(ls -1t "${MMLU_DIR}"/*.json 2>/dev/null | head -1)"
  if [[ -n "${mmlu_json}" ]]; then python3 generate_report_from_json.py "${mmlu_json}" |& tee -a "${MMLU_DIR}/report.log" || true; fi
fi

log "All-in-one complete → ${RESULTS_DIR}"
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
