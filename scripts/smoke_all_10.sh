#!/usr/bin/env bash
set -Eeuo pipefail

# 10-step smoke: MLPerf(Server perf→report, Server acc→report, Offline perf→report, Offline acc→report), then MMLU→report

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="${ROOT_DIR}/inference-master/language/llama3.1-8b"
RUN_ID="${RUN_ID:-$(date +%Y%m%d-%H%M%S)}"
RESULTS_DIR="${ROOT_DIR}/results/${RUN_ID}"
LOG_DIR="${RESULTS_DIR}/logs"
MLPERF_DIR="${RESULTS_DIR}/mlperf"
MMLU_DIR="${RESULTS_DIR}/mmlu"
mkdir -p "${RESULTS_DIR}" "${LOG_DIR}" "${MLPERF_DIR}" "${MMLU_DIR}" "${ROOT_DIR}/.hf_cache"

# Load tokens
if [[ -f "${ROOT_DIR}/.env" ]]; then set -o allexport; . "${ROOT_DIR}/.env"; set +o allexport; fi
if [[ -n "${HUGGINGFACE_TOKEN:-}" ]]; then export HUGGINGFACE_HUB_TOKEN="${HUGGINGFACE_TOKEN}"; fi
if [[ -n "${HF_TOKEN:-}" ]]; then export HUGGINGFACE_HUB_TOKEN="${HF_TOKEN}"; fi

MODEL_ID="${MODEL_ID:-meta-llama/Meta-Llama-3.1-8B-Instruct}"
DTYPE="${DTYPE:-bfloat16}"
GPU_COUNT="$(nvidia-smi --list-gpus 2>/dev/null | wc -l | awk '{print $1}')"; GPU_COUNT=${GPU_COUNT:-1}

# vLLM safety defaults
export VLLM_MAX_MODEL_LEN="${MAX_LEN_USER:-4096}"
export VLLM_GPU_MEM_UTILIZATION="${GPU_MEM_UTIL:-0.90}"
export VLLM_KV_CACHE_DTYPE="${KV_CACHE_DTYPE:-auto}"
export PYTORCH_CUDA_ALLOC_CONF="${PYTORCH_CUDA_ALLOC_CONF:-expandable_segments:True}"
export VLLM_ENFORCE_EAGER="${VLLM_ENFORCE_EAGER:-1}"

log(){ printf "[INFO] %s\n" "$*"; }
err(){ printf "[ERROR] %s\n" "$*" >&2; }

# Defaults
SMOKE_SAMPLES="${SMOKE_SAMPLES:-5}"
SMOKE_FAST="${SMOKE_FAST:-1}"
RUN_PERF_SERVER="${RUN_PERF_SERVER:-1}"
RUN_ACC_SERVER="${RUN_ACC_SERVER:-$([[ "${SMOKE_FAST}" == "1" ]] && echo 0 || echo 1)}"
RUN_PERF_OFFLINE="${RUN_PERF_OFFLINE:-$([[ "${SMOKE_FAST}" == "1" ]] && echo 0 || echo 1)}"
RUN_ACC_OFFLINE="${RUN_ACC_OFFLINE:-$([[ "${SMOKE_FAST}" == "1" ]] && echo 0 || echo 1)}"
RUN_MMLU_SMOKE="${RUN_MMLU_SMOKE:-$([[ "${SMOKE_FAST}" == "1" ]] && echo 0 || echo 1)}"

# Kill leftovers using GPU
pgrep -f "python.*inference-master/language/llama3.1-8b/main.py" >/dev/null 2>&1 && { pkill -TERM -f "python.*inference-master/language/llama3.1-8b/main.py" || true; sleep 1; pkill -9 -f "python.*inference-master/language/llama3.1-8b/main.py" || true; }
pgrep -f "python.*lm_eval" >/dev/null 2>&1 && { pkill -TERM -f "python.*lm_eval" || true; sleep 1; pkill -9 -f "python.*lm_eval" || true; }

# Resolve HF snapshot path
CHECKPOINT_PATH=$(HF_HOME="${ROOT_DIR}/.hf_cache" MODEL_ID="${MODEL_ID}" python3 - <<'PY'
import os,glob; r=os.environ.get("HF_HOME","."); m=os.environ["MODEL_ID"].replace('/','--')
c=sorted(glob.glob(os.path.join(r,f"models--{m}","snapshots","*")),key=os.path.getmtime,reverse=True)
print(c[0] if c else "")
PY
)
[[ -z "$CHECKPOINT_PATH" ]] && { err "Model not in cache"; exit 2; }

# Dataset
DATASET_PATH="${RESULTS_DIR}/data/cnn_eval.json"; mkdir -p "${RESULTS_DIR}/data"
if [[ ! -s "$DATASET_PATH" ]]; then
  log "Generating CNN/DM eval set..."
  (cd "$APP_DIR" && python3 download_cnndm.py --model-id "$MODEL_ID") > "$LOG_DIR/build_cnndm.log" 2>&1 || exit 2
  mv "$APP_DIR/data/cnn_eval.json" "$DATASET_PATH"; rm -rf "$APP_DIR/data"
fi

# Smoke user.conf
SMOKE_USER_CONF="${RESULTS_DIR}/user_smoke.conf"
cat > "${SMOKE_USER_CONF}" <<CONF
*.Server.target_qps = 0.05
*.Server.min_duration = 5000
*.Server.min_query_count = ${SMOKE_SAMPLES}
*.Offline.min_duration = 5000
*.Offline.min_query_count = ${SMOKE_SAMPLES}
CONF

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
    python -u main.py \
      --scenario "$scenario" \
      --model-path "$CHECKPOINT_PATH" \
      --batch-size $([[ "${SMOKE_FAST}" == "1" ]] && echo 1 || echo 16) \
      $([[ "$mode" == "accuracy" ]] && echo "--accuracy") \
      --dtype "$DTYPE" \
      --user-conf "${SMOKE_USER_CONF}" \
      --total-sample-count "${SMOKE_SAMPLES}" \
      --dataset-path "$DATASET_PATH" \
      --output-log-dir "$outdir" \
      --tensor-parallel-size "$GPU_COUNT" \
      --vllm
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

# 1) Server perf → report
if [[ "${RUN_PERF_SERVER}" == "1" ]]; then
  out_srv_perf="${MLPERF_DIR}/server_performance"
  run_ref Server performance "${out_srv_perf}"
  generate_report_for_dir "${out_srv_perf}"
fi

# 2) Server accuracy → report
if [[ "${RUN_ACC_SERVER}" == "1" ]]; then
  out_srv_acc="${MLPERF_DIR}/server_accuracy"
  run_ref Server accuracy "${out_srv_acc}"
  generate_report_for_dir "${out_srv_acc}"
fi

# 3) Offline perf → report
if [[ "${RUN_PERF_OFFLINE}" == "1" ]]; then
  out_off_perf="${MLPERF_DIR}/offline_performance"
  run_ref Offline performance "${out_off_perf}"
  generate_report_for_dir "${out_off_perf}"
fi

# 4) Offline accuracy → report
if [[ "${RUN_ACC_OFFLINE}" == "1" ]]; then
  out_off_acc="${MLPERF_DIR}/offline_accuracy"
  run_ref Offline accuracy "${out_off_acc}"
  generate_report_for_dir "${out_off_acc}"
fi

# 5) MMLU → report
if [[ "${RUN_MMLU_SMOKE}" == "1" ]]; then
  log "MMLU smoke..."
  python3 -m lm_eval --model vllm \
    --model_args "pretrained=${CHECKPOINT_PATH},dtype=${MMLU_DTYPE:-float16},tensor_parallel_size=${GPU_COUNT},gpu_memory_utilization=0.85,max_model_len=512,max_num_batched_tokens=512,max_num_seqs=1,enforce_eager=True,trust_remote_code=True" \
    --tasks mmlu_high_school_biology --batch_size ${MMLU_BATCH:-1} --num_fewshot 0 ${MMLU_LIMIT:+--limit ${MMLU_LIMIT}} \
    --output_path "${MMLU_DIR}" --log_samples |& tee -a "${MMLU_DIR}/lm_eval.log"
  mmlu_json="$(ls -1t "${MMLU_DIR}"/*.json 2>/dev/null | head -1)"
  if [[ -n "${mmlu_json}" ]]; then
    python3 generate_report_from_json.py "${mmlu_json}" |& tee -a "${MMLU_DIR}/report.log" || true
  fi
fi

log "Smoke complete → ${RESULTS_DIR}"

#!/usr/bin/env bash
set -Eeuo pipefail

# 10-sample smoke for the full pipeline: MLPerf (perf + accuracy + edge), then MMLU-small.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="${ROOT_DIR}/inference-master/language/llama3.1-8b"
RUN_ID="${RUN_ID:-$(date +%Y%m%d-%H%M%S)}"
RESULTS_DIR="${ROOT_DIR}/results/${RUN_ID}"
LOG_DIR="${RESULTS_DIR}/logs"
MLPERF_DIR="${RESULTS_DIR}/mlperf"
MMLU_DIR="${RESULTS_DIR}/mmlu"
mkdir -p "${RESULTS_DIR}" "${LOG_DIR}" "${MLPERF_DIR}" "${MMLU_DIR}" "${ROOT_DIR}/.hf_cache"

# Load .env if present (exports HUGGINGFACE_TOKEN / HF_TOKEN)
if [[ -f "${ROOT_DIR}/.env" ]]; then
  set -o allexport; . "${ROOT_DIR}/.env"; set +o allexport
fi
if [[ -n "${HUGGINGFACE_TOKEN:-}" ]]; then export HUGGINGFACE_HUB_TOKEN="${HUGGINGFACE_TOKEN}"; fi
if [[ -n "${HF_TOKEN:-}" ]]; then export HUGGINGFACE_HUB_TOKEN="${HF_TOKEN}"; fi

MODEL_ID="${MODEL_ID:-meta-llama/Meta-Llama-3.1-8B-Instruct}"
DTYPE="${DTYPE:-bfloat16}"
GPU_COUNT="$(nvidia-smi --list-gpus 2>/dev/null | wc -l | awk '{print $1}')"; GPU_COUNT=${GPU_COUNT:-1}

# vLLM safety defaults for smoke (avoid 131072 default max seq len)
export VLLM_MAX_MODEL_LEN="${MAX_LEN_USER:-4096}"
export VLLM_GPU_MEM_UTILIZATION="${GPU_MEM_UTIL:-0.95}"
export VLLM_KV_CACHE_DTYPE="${KV_CACHE_DTYPE:-auto}"
export PYTORCH_CUDA_ALLOC_CONF="${PYTORCH_CUDA_ALLOC_CONF:-expandable_segments:True}"
export VLLM_ENFORCE_EAGER="${VLLM_ENFORCE_EAGER:-1}"

log(){ printf "[INFO] %s\n" "$*"; }
err(){ printf "[ERROR] %s\n" "$*" >&2; }

# Kill stale benchmark processes to free VRAM
kill_stale(){
  local pids
  pids=$(pgrep -f "python.*inference-master/language/llama3.1-8b/main.py" || true)
  if [[ -n "$pids" ]]; then
    log "Killing stale MLPerf main.py PIDs: $pids"
    kill -TERM $pids 2>/dev/null || true; sleep 1; kill -9 $pids 2>/dev/null || true
  fi
  pids=$(pgrep -f "python.*lm_eval" || true)
  if [[ -n "$pids" ]]; then
    log "Killing stale lm_eval PIDs: $pids"
    kill -TERM $pids 2>/dev/null || true; sleep 1; kill -9 $pids 2>/dev/null || true
  fi
}
kill_stale

# Tighten GPU mem util on fast smoke to avoid OOMs
GPU_MEM_UTIL_DEFAULT="0.95"
if [[ "${SMOKE_FAST:-0}" == "1" ]]; then
  GPU_MEM_UTIL_DEFAULT="0.88"
fi

# Choose a valid kv cache dtype (auto or fp8). fp16 is not supported by vLLM.
if [[ -z "${KV_CACHE_DTYPE:-}" || "${KV_CACHE_DTYPE}" == "auto" ]]; then
  HAS_TE="$(python3 - <<'PY'
try:
    import transformer_engine
    print("yes")
except Exception:
    print("")
PY
)"
  if [[ "${HAS_TE}" == "yes" ]]; then
    export VLLM_KV_CACHE_DTYPE=fp8
  else
    export VLLM_KV_CACHE_DTYPE=auto
  fi
else
  export VLLM_KV_CACHE_DTYPE="${KV_CACHE_DTYPE}"
fi

# Optionally kill any python GPU processes owned by current user that belong to this repo or vLLM
kill_gpu_hogs(){
  local rows pid pname owner cmd
  rows=$(nvidia-smi --query-compute-apps=pid,process_name --format=csv,noheader 2>/dev/null || true)
  [[ -z "$rows" ]] && return 0
  while IFS=, read -r pid pname; do
    pid=$(echo "$pid" | xargs); pname=$(echo "$pname" | xargs)
    [[ -z "$pid" ]] && continue
    # Only target python
    [[ "$pname" != *python* ]] && continue
    owner=$(ps -o user= -p "$pid" 2>/dev/null | xargs || true)
    [[ "$owner" != "${USER}" ]] && continue
    cmd=$(tr '\0' ' ' < "/proc/${pid}/cmdline" 2>/dev/null || true)
    # Limit to our repo or vllm processes to avoid killing unrelated jobs
    if [[ "$cmd" == *"MLPerf_local_test"* || "$cmd" == *"vllm"* ]]; then
      log "Killing GPU python PID $pid ($pname) with cmd: $cmd"
      kill -TERM "$pid" 2>/dev/null || true; sleep 1; kill -9 "$pid" 2>/dev/null || true
    fi
  done <<< "$rows"
}
if [[ "${SMOKE_FAST:-0}" == "1" || "${FORCE_FREE_GPU:-0}" == "1" ]]; then
  kill_gpu_hogs || true
fi

# What to run toggles (defaults to a minimal, fast smoke)
RUN_PERF_SERVER="${RUN_PERF_SERVER:-}"
RUN_PERF_OFFLINE="${RUN_PERF_OFFLINE:-}"
RUN_ACC_OFFLINE="${RUN_ACC_OFFLINE:-}"
RUN_ACC_SERVER="${RUN_ACC_SERVER:-}"
RUN_EDGE_ACC="${RUN_EDGE_ACC:-}"
RUN_MMLU_SMOKE="${RUN_MMLU_SMOKE:-}"
# Always decide defaults per-toggle so one explicit var doesn't suppress others
SMOKE_FAST="${SMOKE_FAST:-1}"
[[ -z "${RUN_PERF_SERVER}"   ]] && RUN_PERF_SERVER=1
[[ -z "${RUN_PERF_OFFLINE}"  ]] && RUN_PERF_OFFLINE=$([[ "${SMOKE_FAST}" == "1" ]] && echo 0 || echo 1)
[[ -z "${RUN_ACC_OFFLINE}"   ]] && RUN_ACC_OFFLINE=$([[ "${SMOKE_FAST}" == "1" ]] && echo 0 || echo 1)
[[ -z "${RUN_ACC_SERVER}"    ]] && RUN_ACC_SERVER=$([[ "${SMOKE_FAST}" == "1" ]] && echo 0 || echo 1)
[[ -z "${RUN_EDGE_ACC}"      ]] && RUN_EDGE_ACC=$([[ "${SMOKE_FAST}" == "1" ]] && echo 0 || echo 1)
[[ -z "${RUN_MMLU_SMOKE}"    ]] && RUN_MMLU_SMOKE=$([[ "${SMOKE_FAST}" == "1" ]] && echo 0 || echo 1)

# Resolve model snapshot
CHECKPOINT_PATH=$(HF_HOME="${ROOT_DIR}/.hf_cache" MODEL_ID="${MODEL_ID}" python3 - <<'PY'
import os,glob; r=os.environ.get("HF_HOME","."); m=os.environ["MODEL_ID"].replace('/','--')
c=sorted(glob.glob(os.path.join(r,f"models--{m}","snapshots","*")),key=os.path.getmtime,reverse=True)
print(c[0] if c else "")
PY
)
[[ -z "$CHECKPOINT_PATH" ]] && { err "Model not in cache"; exit 2; }

# Dataset
DATASET_PATH="${RESULTS_DIR}/data/cnn_eval.json"; mkdir -p "${RESULTS_DIR}/data"
if [[ ! -s "$DATASET_PATH" ]]; then
  log "Generating CNN/DM eval set..."
  (cd "$APP_DIR" && python3 download_cnndm.py --model-id "$MODEL_ID") > "$LOG_DIR/build_cnndm.log" 2>&1 || exit 2
  mv "$APP_DIR/data/cnn_eval.json" "$DATASET_PATH"; rm -rf "$APP_DIR/data"
fi

# Smoke sampling controls
# Default fewer samples to speed up smoke (can override via env)
SMOKE_SAMPLES="${SMOKE_SAMPLES:-5}"
SMOKE_USER_CONF="${RESULTS_DIR}/user_smoke.conf"
cat > "${SMOKE_USER_CONF}" <<CONF
# Light-weight settings for smoke runs
*.Server.target_qps = 0.05
*.Server.min_duration = 5000
*.Server.min_query_count = ${SMOKE_SAMPLES}
*.Offline.min_duration = 5000
*.Offline.min_query_count = ${SMOKE_SAMPLES}
CONF

run_ref(){
  local scenario="$1"; local mode="$2"; local outdir="$3"; shift 3
  mkdir -p "$outdir"
  log "${scenario} ${mode} → $outdir"
  (
    cd "$APP_DIR"
    VLLM_MAX_MODEL_LEN="${MAX_LEN_USER:-4096}" \
    VLLM_GPU_MEM_UTILIZATION="${GPU_MEM_UTIL:-${GPU_MEM_UTIL_DEFAULT}}" \
    VLLM_KV_CACHE_DTYPE="${VLLM_KV_CACHE_DTYPE}" \
    VLLM_ENFORCE_EAGER="${VLLM_ENFORCE_EAGER:-1}" \
    python -u main.py \
      --scenario "$scenario" \
      --model-path "$CHECKPOINT_PATH" \
      --batch-size $([[ "${SMOKE_FAST:-0}" == "1" ]] && echo 1 || echo 16) \
      $([[ "$mode" == "accuracy" ]] && echo "--accuracy") \
      --dtype "$DTYPE" \
      --user-conf $([[ "${SMOKE_FAST:-0}" == "1" ]] && echo "${SMOKE_USER_CONF}" || echo "user.conf") \
      --total-sample-count $([[ "${SMOKE_FAST:-0}" == "1" ]] && echo "${SMOKE_SAMPLES}" || echo 10) \
      --dataset-path "$DATASET_PATH" \
      --output-log-dir "$outdir" \
      --tensor-parallel-size "$GPU_COUNT" \
      --vllm "$@"
  ) |& tee -a "$outdir/run.log"
}

# --- Helpers to generate reports per step ---
generate_report_for_dir() {
  local outdir="$1"
  local prefer_json=""
  # Prefer known MLPerf JSON names
  if [[ -f "${outdir}/mlperf_log_summary.json" ]]; then
    prefer_json="${outdir}/mlperf_log_summary.json"
  elif [[ -f "${outdir}/mlperf_log_accuracy.json" ]]; then
    prefer_json="${outdir}/mlperf_log_accuracy.json"
  else
    # Fallback: pick latest json in outdir
    prefer_json="$(ls -1t "${outdir}"/*.json 2>/dev/null | head -1)"
  fi
  if [[ -n "${prefer_json}" ]]; then
    log "Generating report for ${outdir} using ${prefer_json}"
    python3 generate_report_from_json.py "${prefer_json}" |& tee -a "${outdir}/report.log" || true
  else
    err "No JSON found in ${outdir} for reporting"
  fi
}

# 1) MLPerf Server performance → report
if [[ "${RUN_PERF_SERVER}" == "1" ]]; then
  outdir_srv_perf="${MLPERF_DIR}/server_performance"
  run_ref Server performance "${outdir_srv_perf}"
  generate_report_for_dir "${outdir_srv_perf}"
fi

# 2) MLPerf Server accuracy → report
if [[ "${RUN_ACC_SERVER}" == "1" ]]; then
  outdir_srv_acc="${MLPERF_DIR}/server_accuracy"
  run_ref Server accuracy "${outdir_srv_acc}"
  generate_report_for_dir "${outdir_srv_acc}"
fi

# 3) MLPerf Offline performance → report
if [[ "${RUN_PERF_OFFLINE}" == "1" ]]; then
  outdir_off_perf="${MLPERF_DIR}/offline_performance"
  run_ref Offline performance "${outdir_off_perf}"
  generate_report_for_dir "${outdir_off_perf}"
fi

# 4) MLPerf Offline accuracy → report
if [[ "${RUN_ACC_OFFLINE}" == "1" ]]; then
  outdir_off_acc="${MLPERF_DIR}/offline_accuracy"
  run_ref Offline accuracy "${outdir_off_acc}"
  generate_report_for_dir "${outdir_off_acc}"
fi

# 5) MMLU smoke → report
if [[ "${RUN_MMLU_SMOKE}" == "1" ]]; then
  log "MMLU smoke..."
  python3 -m lm_eval --model vllm \
    --model_args "pretrained=${CHECKPOINT_PATH},dtype=${MMLU_DTYPE:-float16},tensor_parallel_size=${GPU_COUNT},gpu_memory_utilization=0.85,max_model_len=512,max_num_batched_tokens=512,max_num_seqs=1,enforce_eager=True,trust_remote_code=True" \
    --tasks mmlu_high_school_biology --batch_size ${MMLU_BATCH:-1} --num_fewshot 0 ${MMLU_LIMIT:+--limit ${MMLU_LIMIT}} \
    --output_path "${MMLU_DIR}" --log_samples |& tee -a "${MMLU_DIR}/lm_eval.log"
  # Generate MMLU report from the latest JSON under MMLU_DIR
  mmlu_json="$(ls -1t "${MMLU_DIR}"/*.json 2>/dev/null | head -1)"
  if [[ -n "${mmlu_json}" ]]; then
    python3 generate_report_from_json.py "${mmlu_json}" |& tee -a "${MMLU_DIR}/report.log" || true
  fi
fi

log "Smoke complete → $RESULTS_DIR"

