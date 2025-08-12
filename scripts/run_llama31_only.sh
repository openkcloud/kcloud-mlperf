#!/usr/bin/env bash
set -Eeuo pipefail

# ==============================================================================
# MLPerf Inference & MMLU for Llama 3.1 8B via vLLM
# - Final version, fully adapted to the user's specific (older) local
#   MLPerf repository scripts. Re-instates the SUT patcher and fixes MMLU args.
# ==============================================================================

# ---------- Knobs (override via env or a .env file) ----------
: "${MODEL_ID:=meta-llama/Meta-Llama-3.1-8B-Instruct}"
: "${DTYPE:=bfloat16}"
: "${GPU_MEM_UTIL:=0.92}"
: "${KV_CACHE_DTYPE:=auto}"
: "${SCENARIOS:=Server,Offline}"
: "${RUN_ACCURACY:=0}"
: "${TP_OVERRIDE:=}"
# Prefer larger batch by default to speed up MLPerf (user can still override)
: "${BATCH_SIZE_OVERRIDE:=100}"
: "${MAX_LEN_USER:=}"

# Optional MMLU
: "${RUN_MMLU:=1}"
: "${MMLU_TASKS:=mmlu}"
: "${MMLU_FEWSHOT:=5}"
: "${MMLU_BATCH:=auto}"
: "${MMLU_LIMIT:=}"
: "${MMLU_DTYPE:=bfloat16}"

export PYTHONUNBUFFERED=1
export TRANSFORMERS_NO_ADVISORY_WARNINGS=1
export TOKENIZERS_PARALLELISM=false
export VLLM_USE_RAY=0
export PYTORCH_CUDA_ALLOC_CONF=${PYTORCH_CUDA_ALLOC_CONF:-"expandable_segments:True"}

# ---------- Paths ----------
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_ID="$(date +%Y%m%d-%H%M%S)"
RESULTS_DIR="${ROOT_DIR}/results/${RUN_ID}"
LOG_DIR="${RESULTS_DIR}/logs"
DATA_DIR="${RESULTS_DIR}/data"
MLPERF_DIR="${RESULTS_DIR}/mlperf"
INFERENCE_DIR="${ROOT_DIR}/inference-master"
APP_DIR="${INFERENCE_DIR}/language/llama3.1-8b"
mkdir -p "${RESULTS_DIR}" "${LOG_DIR}" "${DATA_DIR}" "${MLPERF_DIR}"

# ---------- Helpers ----------
log() { printf '\n[INFO] %s\n' "$*"; }
warn() { printf '[WARN] %s\n' "$*" >&2; }
err() { printf '[ERROR] %s\n' "$*" >&2; }
elapsed() {
  local start_time="$1"
  local end_time; end_time=$(date +%s)
  local total_seconds=$((end_time - start_time))
  printf "%02dh:%02dm:%02ds" "$((total_seconds / 3600))" "$(((total_seconds % 3600) / 60))" "$((total_seconds % 60))"
}

# Load .env if present
if [[ -f "${ROOT_DIR}/.env" ]]; then
  set -o allexport; . "${ROOT_DIR}/.env"; set +o allexport
fi

# ---------- Environment & Sanity Checks ----------
: "${HF_HOME:=${ROOT_DIR}/.hf_cache}"
: "${HUGGINGFACE_HUB_CACHE:=${HF_HOME}}"
: "${HF_HUB_ENABLE_HF_TRANSFER:=1}"
export HF_HOME HUGGINGFACE_HUB_CACHE HF_HUB_ENABLE_HF_TRANSFER
mkdir -p "${HF_HOME}"

# ---------- Model Download ----------
log "Locating model: ${MODEL_ID}"
LLAMA3_CHECKPOINT_PATH="$(HF_HOME="${HF_HOME}" MODEL_ID="${MODEL_ID}" python3 -c 'import os,glob;r=os.environ.get("HF_HOME","");m=os.environ.get("MODEL_ID","");s=m.replace("/","--") if m else "";p=os.path.join(r,f"models--{s}","snapshots");c=sorted(glob.glob(os.path.join(p,"*")),key=os.path.getmtime,reverse=True);print(c[0] if c else "")')"
if [[ -z "${LLAMA3_CHECKPOINT_PATH}" ]]; then
    err "Could not find a local snapshot for ${MODEL_ID}. Please ensure it is downloaded in your HF_HOME."
    exit 1
fi
log "Model path: ${LLAMA3_CHECKPOINT_PATH}"

# ---------- GPU Topology ----------
GPU_COUNT="$(nvidia-smi --list-gpus 2>/dev/null | wc -l)"
TP="${TP_OVERRIDE:-$([[ "${GPU_COUNT}" -gt 0 ]] && echo "${GPU_COUNT}" || echo 1)}"
log "Detected ${GPU_COUNT} GPUs | Setting Tensor Parallelism (TP) to ${TP}"

# ---------- Dependency check for dataset script ----------
log "Checking dependencies for dataset generation..."
python3 -c "
import sys, subprocess
def ensure(pkg, name=None):
    try: __import__(name or pkg)
    except ImportError:
        print(f'Installing missing package: {pkg}...', file=sys.stderr)
        subprocess.check_call([sys.executable, '-m', 'pip', 'install', '-q', pkg])
ensure('nltk'); ensure('rouge_score', name='rouge_score'); ensure('pandas');
"

# ---------- Dataset Prep ----------
DATASET_PATH="${DATA_DIR}/cnn_eval.json"
if [[ ! -s "${DATASET_PATH}" ]]; then
  log "Generating CNN/DailyMail eval set (using local script)..."
  start_ts=$(date +%s)
  SOURCE_FILE_PATH="${APP_DIR}/data/cnn_eval.json"
  rm -rf "${APP_DIR}/data"
  (
    cd "${APP_DIR}"
    python3 download_cnndm.py --model-id "${MODEL_ID}"
  ) > "${LOG_DIR}/build_cnndm.log" 2>&1 || { err "Build CNN/DM failed (see ${LOG_DIR}/build_cnndm.log)"; exit 1; }
  if [[ ! -f "${SOURCE_FILE_PATH}" ]]; then
      err "Dataset generation failed: script did not create the output file at ${SOURCE_FILE_PATH}."
      exit 1
  fi
  log "Moving generated dataset from ${SOURCE_FILE_PATH} to ${DATASET_PATH}"
  mv "${SOURCE_FILE_PATH}" "${DATASET_PATH}"
  rm -rf "${APP_DIR}/data"
  log "CNN/DM build done in $(elapsed "${start_ts}")."
fi
log "Dataset path: ${DATASET_PATH}"

# ---------- Max Length & KV Cache Heuristics ----------
GPU_MEM_MB_MIN="$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits | awk 'NR==1{m=$1} $1<m{m=$1} END{print m+0}')"
GPU_MEM_GB="$(( GPU_MEM_MB_MIN / 1024 ))"
BATCH_SIZE="${BATCH_SIZE_OVERRIDE:-$([[ "${GPU_MEM_GB}" -le 24 ]] && echo 1 || echo 2)}"
LG_MODEL_NAME="$([[ "${GPU_MEM_GB}" -le 24 ]] && echo "llama3_1-8b-edge" || echo "llama3_1-8b")"

pick_max_len() {
  local vram_gb="$1"
  # If user specified, respect it
  if [[ -n "${MAX_LEN_USER}" ]]; then echo "${MAX_LEN_USER}"; return; fi
  # Conservative defaults to avoid KV cache over-allocation on 24GB GPUs
  if   [[ "${vram_gb}" -le 24 ]]; then echo 4096
  elif [[ "${vram_gb}" -le 32 ]]; then echo 8192
  else                              echo 16384
  fi
}
MAX_MODEL_LEN="$(pick_max_len "${GPU_MEM_GB}")"

if [[ "${KV_CACHE_DTYPE}" == "auto" ]]; then
  if python3 -c 'import transformer_engine' >/dev/null 2>&1; then
    KV_CACHE_DTYPE="fp8"
  fi
fi

# ---------- SUT Patcher (Required for old repo version) ----------
log "Patching SUT_VLLM.py to accept environment variables..."
APP_DIR="${APP_DIR}" python3 - <<'PY'
import os, re, pathlib, sys
p = pathlib.Path(os.environ["APP_DIR"]) / "SUT_VLLM.py"
if not p.exists(): sys.exit(0)
s = p.read_text()
if "# [env-overrides-patch]" in s:
    print("Already patched.")
    sys.exit(0)
s = re.sub(
    r'^(\s*)self\.model\s*=\s*AsyncLLMEngine\.from_engine_args\(\s*self\.engine_args\s*\)\s*$',
    (
        r'\1# [env-overrides-patch] apply engine_args overrides from env\n'
        r'\1import os as _os\n'
        r"\1if _os.getenv('VLLM_MAX_MODEL_LEN'): self.engine_args.max_model_len = int(_os.getenv('VLLM_MAX_MODEL_LEN'))\n"
        r"\1if _os.getenv('VLLM_GPU_MEM_UTILIZATION'): self.engine_args.gpu_memory_utilization = float(_os.getenv('VLLM_GPU_MEM_UTILIZATION'))\n"
        r"\1if _os.getenv('VLLM_KV_CACHE_DTYPE'): self.engine_args.kv_cache_dtype = _os.getenv('VLLM_KV_CACHE_DTYPE')\n"
        r'\1self.model = AsyncLLMEngine.from_engine_args(self.engine_args)'
    ),
    s,
    count=1,
    flags=re.M
)
p.write_text(s)
print("Patch applied successfully.")
PY

# Set envs for the patcher to read
export VLLM_GPU_MEM_UTILIZATION="${GPU_MEM_UTIL}"
export VLLM_KV_CACHE_DTYPE="${KV_CACHE_DTYPE}"

# ---------- Runner with OOM Retries ----------
run_case_with_retries() {
  local scenario="$1"
  local accuracy_run="$2"
  local mode="performance"; [[ "${accuracy_run}" == "1" ]] && mode="accuracy"
  local scen_lower; scen_lower="$(tr '[:upper:]' '[:lower:]' <<<"${scenario}")"
  local outdir="${MLPERF_DIR}/${scen_lower}_${mode}"
  mkdir -p "${outdir}"
  local max_len_try="${MAX_MODEL_LEN}"
  local lg_name_try="${LG_MODEL_NAME}"
  local batch_size_try="${BATCH_SIZE}"
  
  export VLLM_MAX_MODEL_LEN="${max_len_try}"
  log "Starting MLPerf ${scenario} (${mode}) [max_len=${max_len_try}, profile=${lg_name_try}, batch=${batch_size_try}]"
  local start_ts; start_ts="$(date +%s)"
  set +e
  (
    cd "${APP_DIR}"
    # Call main.py WITHOUT --vllm-* args, as the patch handles it
    python3 main.py \
      --scenario "${scenario}" --model-path "${LLAMA3_CHECKPOINT_PATH}" --dataset-path "${DATASET_PATH}" \
      $([[ "${accuracy_run}" == "1" ]] && echo "--accuracy") \
      --dtype "${DTYPE}" --vllm --tensor-parallel-size "${TP}" --batch-size "${batch_size_try}" \
      --lg-model-name "${lg_name_try}" --output-log-dir "${outdir}"
  ) |& tee -a "${outdir}/run.log"
  local rc=${PIPESTATUS[0]}
  set -e
  if [[ ${rc} -eq 0 ]]; then
    log "MLPerf ${scenario} (${mode}) finished successfully in $(elapsed "${start_ts}")."
  else
    err "MLPerf ${scenario} (${mode}) failed. See log: ${outdir}/run.log"
  fi
}

# ---------- Run MLPerf & MMLU ----------
IFS=',' read -r -a SCEN_ARR <<< "${SCENARIOS}"
for scen in "${SCEN_ARR[@]}"; do
  [[ -z "${scen}" ]] && continue
  run_case_with_retries "${scen}" 0 || true
done

if [[ "${RUN_ACCURACY}" == "1" ]]; then
  run_case_with_retries "Offline" 1 || true
fi

if [[ "${RUN_MMLU}" == "1" ]]; then
  MMLU_DIR="${RESULTS_DIR}/mmlu"
  mkdir -p "${MMLU_DIR}"
  log "Starting MMLU run..."
  M_LIMIT_FLAG=(); [[ -n "${MMLU_LIMIT}" ]] && M_LIMIT_FLAG=(--limit "${MMLU_LIMIT}")
  # Removed 'tensor_parallel_size' from model_args
  python3 -m lm_eval --model hf --model_args "pretrained=${LLAMA3_CHECKPOINT_PATH},dtype=${MMLU_DTYPE},trust_remote_code=True" \
    --tasks "${MMLU_TASKS}" --batch_size "${MMLU_BATCH}" --device "cuda" --num_fewshot "${MMLU_FEWSHOT}" \
    --output_path "${MMLU_DIR}/results.json" --log_samples "${M_LIMIT_FLAG[@]}" |& tee -a "${MMLU_DIR}/lm_eval.log"
  log "MMLU run finished."
fi

log "All tasks complete. Artifacts are in: ${RESULTS_DIR}"