#!/usr/bin/env bash
set -Eeuo pipefail

# 10-step smoke: MLPerf(Server perf→report, Server acc→report, Offline perf→report, Offline acc→report), then MMLU→report

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="${ROOT_DIR}/inference-master/language/llama3.1-8b"
# When running in Docker, /app is the root; ensure APP_DIR exists there too
if [[ -d "/app/inference-master/language/llama3.1-8b" ]]; then
  APP_DIR="/app/inference-master/language/llama3.1-8b"
fi
RUN_ID="${RUN_ID:-$(date +%Y%m%d-%H%M%S)}"
RESULTS_DIR="${ROOT_DIR}/results/${RUN_ID}"
LOG_DIR="${RESULTS_DIR}/logs"
MLPERF_DIR="${RESULTS_DIR}/mlperf"
MMLU_DIR="${RESULTS_DIR}/mmlu"
mkdir -p "${RESULTS_DIR}" "${LOG_DIR}" "${MLPERF_DIR}" "${MMLU_DIR}" "${HF_HOME}"

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
export HF_HOME="${HF_HOME:-/app/.cache/huggingface}"
export HUGGINGFACE_HUB_CACHE="${HUGGINGFACE_HUB_CACHE:-${HF_HOME}}"
export HF_DATASETS_CACHE="${HF_DATASETS_CACHE:-${HF_HOME}/datasets}"
export TORCHINDUCTOR_CACHE_DIR="${TORCHINDUCTOR_CACHE_DIR:-/app/.cache/torchinductor}"
export MKL_THREADING_LAYER="${MKL_THREADING_LAYER:-GNU}"
export MKL_SERVICE_FORCE_INTEL="${MKL_SERVICE_FORCE_INTEL:-1}"
export SMOKE_PROMPT_TOKENS="${SMOKE_PROMPT_TOKENS:-2048}"
export SMOKE_MAX_NEW_TOKENS="${SMOKE_MAX_NEW_TOKENS:-64}"

TS(){ date '+%Y-%m-%d %H:%M:%S'; }
log(){ printf "[%s] [INFO] %s\n" "$(TS)" "$*"; }
err(){ printf "[%s] [ERROR] %s\n" "$(TS)" "$*" >&2; }

# Ensure HF_HOME is writable even when running with --user uid:gid
ensure_dir(){
  local d="$1"
  mkdir -p "$d" 2>/dev/null && [ -w "$d" ]
}
if ! ensure_dir "$HF_HOME"; then
  # Try preferred mounted cache path
  if ensure_dir "/app/.cache/huggingface"; then
    export HF_HOME="/app/.cache/huggingface"
    export HUGGINGFACE_HUB_CACHE="${HF_HOME}"
  # Fallback to /tmp if all else fails
  elif ensure_dir "/tmp/hf_cache"; then
    export HF_HOME="/tmp/hf_cache"
    export HUGGINGFACE_HUB_CACHE="${HF_HOME}"
  else
    err "Cannot create a writable HF_HOME. Check volume mounts or permissions."
    exit 2
  fi
fi
log "Using HF_HOME=${HF_HOME}"

# CLI flags (independent toggles)
usage(){ cat <<USAGE
Usage: $(basename "$0") [options]
  --server-perf [0|1]     Server 성능 실행 (기본 1)
  --server-acc  [0|1]     Server 정확도 실행 (기본 1)
  --offline-perf [0|1]    Offline 성능 실행 (기본 1)
  --offline-acc  [0|1]    Offline 정확도 실행 (기본 1)
  --mmlu         [0|1]    MMLU 실행 (기본 1)
  --samples N             스모크 샘플 수 (기본 5)
  --fast                  빠른 모드(보수적 메모리/배치)
  --verbose               상세 로그(set -x)
  --help                  도움말
USAGE
}

CLI_RUN_PERF_SERVER=""; CLI_RUN_ACC_SERVER=""; CLI_RUN_PERF_OFFLINE=""; CLI_RUN_ACC_OFFLINE=""; CLI_RUN_MMLU=""; CLI_SAMPLES=""; CLI_FAST=""; CLI_VERBOSE="";
while [[ $# -gt 0 ]]; do
  case "$1" in
    --server-perf)   CLI_RUN_PERF_SERVER="${2:-1}"; shift 2;;
    --server-acc)    CLI_RUN_ACC_SERVER="${2:-1}"; shift 2;;
    --offline-perf)  CLI_RUN_PERF_OFFLINE="${2:-1}"; shift 2;;
    --offline-acc)   CLI_RUN_ACC_OFFLINE="${2:-1}"; shift 2;;
    --mmlu)          CLI_RUN_MMLU="${2:-1}"; shift 2;;
    --samples)       CLI_SAMPLES="${2}"; shift 2;;
    --fast)          CLI_FAST=1; shift;;
    --verbose)       CLI_VERBOSE=1; shift;;
    --help|-h)       usage; exit 0;;
    *) err "Unknown arg: $1"; usage; exit 2;;
  esac
done

# Defaults + apply CLI/env overrides
SMOKE_SAMPLES="${CLI_SAMPLES:-${SMOKE_SAMPLES:-5}}"
SMOKE_FAST="${CLI_FAST:-${SMOKE_FAST:-1}}"
RUN_PERF_SERVER="${CLI_RUN_PERF_SERVER:-${RUN_PERF_SERVER:-1}}"
RUN_ACC_SERVER="${CLI_RUN_ACC_SERVER:-${RUN_ACC_SERVER:-1}}"
RUN_PERF_OFFLINE="${CLI_RUN_PERF_OFFLINE:-${RUN_PERF_OFFLINE:-1}}"
RUN_ACC_OFFLINE="${CLI_RUN_ACC_OFFLINE:-${RUN_ACC_OFFLINE:-1}}"
RUN_MMLU_SMOKE="${CLI_RUN_MMLU:-${RUN_MMLU_SMOKE:-1}}"
VERBOSE="${CLI_VERBOSE:-${VERBOSE:-0}}"
[[ "${VERBOSE}" == "1" ]] && set -x

# Kill leftovers using GPU
pgrep -f "python.*inference-master/language/llama3.1-8b/main.py" >/dev/null 2>&1 && { pkill -TERM -f "python.*inference-master/language/llama3.1-8b/main.py" || true; sleep 1; pkill -9 -f "python.*inference-master/language/llama3.1-8b/main.py" || true; }
pgrep -f "python.*lm_eval" >/dev/null 2>&1 && { pkill -TERM -f "python.*lm_eval" || true; sleep 1; pkill -9 -f "python.*lm_eval" || true; }

# Resolve HF snapshot path
CHECKPOINT_PATH=$(HF_HOME="${HF_HOME}" MODEL_ID="${MODEL_ID}" python3 - <<'PY'
import os,glob; r=os.environ.get("HF_HOME","."); m=os.environ["MODEL_ID"].replace('/','--')
c=sorted(glob.glob(os.path.join(r,f"models--{m}","snapshots","*")),key=os.path.getmtime,reverse=True)
print(c[0] if c else "")
PY
)
ensure_snapshot(){
  python3 - <<'PY'
import os, sys, glob, subprocess
from pathlib import Path
try:
    from huggingface_hub import snapshot_download
except Exception:
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', '-q', 'huggingface_hub'])
    from huggingface_hub import snapshot_download

repo_id = os.environ.get('MODEL_ID')
cache_dir = os.environ.get('HF_HOME')
token = os.environ.get('HUGGINGFACE_HUB_TOKEN') or os.environ.get('HF_TOKEN') or os.environ.get('HUGGINGFACE_TOKEN')

def latest_snap(root, repo):
    m = repo.replace('/', '--')
    snaps = sorted(Path(root, f"models--{m}", 'snapshots').glob('*'), key=lambda p: p.stat().st_mtime, reverse=True)
    return str(snaps[0]) if snaps else ''

snap = latest_snap(cache_dir, repo_id)
need = True
if snap and os.path.isdir(snap):
    # Check for real weight shards
    shards = glob.glob(os.path.join(snap, 'model-*.safetensors'))
    if len(shards) >= 1 or os.path.exists(os.path.join(snap, 'pytorch_model.bin')):
        need = False

if need:
    snapshot_download(repo_id=repo_id, cache_dir=cache_dir, token=token,
                      local_files_only=False, resume_download=True,
                      allow_patterns=[
                        'model*.*', 'pytorch_model*.bin', 'config.json',
                        'tokenizer*', 'generation_config.json'
                      ])
print(latest_snap(cache_dir, repo_id), end='')
PY
}

if [[ -z "$CHECKPOINT_PATH" ]]; then
  log "Downloading ${MODEL_ID} into ${HF_HOME}..."
  CHECKPOINT_PATH=$(ensure_snapshot)
else
  # Validate that real weights exist; if not, force download
  WEIGHT_COUNT=$(CHECKPOINT_PATH="${CHECKPOINT_PATH}" python3 - <<'PY'
import os, glob
p=os.environ.get('CHECKPOINT_PATH','')
if not p:
    print('0')
    raise SystemExit(0)
print(len(glob.glob(os.path.join(p,'model-*.safetensors'))))
PY
  )
  if [[ "${WEIGHT_COUNT}" -lt 1 ]]; then
    log "Weights missing under snapshot. Fetching full weights..."
    CHECKPOINT_PATH=$(ensure_snapshot)
  fi
fi
[[ -z "$CHECKPOINT_PATH" || ! -d "$CHECKPOINT_PATH" ]] && { err "Model snapshot not found (after download)"; exit 2; }

# Dataset (prefer sample-sized file name when SMOKE_SAMPLES > 0)
mkdir -p "${RESULTS_DIR}/data"
DATASET_BASENAME="cnn_eval.json"
if [[ -n "${SMOKE_SAMPLES}" && "${SMOKE_SAMPLES}" != "0" ]]; then
  DATASET_BASENAME="cnn_eval_${SMOKE_SAMPLES}.json"
fi
DATASET_PATH="${RESULTS_DIR}/data/${DATASET_BASENAME}"
if [[ ! -s "$DATASET_PATH" ]]; then
  log "Generating CNN/DM eval set..."
  (cd "$APP_DIR" && DATASET_CNNDM_PATH="${RESULTS_DIR}/data" HF_HOME="${HF_HOME}" HF_DATASETS_CACHE="${HF_DATASETS_CACHE}" python3 download_cnndm.py --model-id "$CHECKPOINT_PATH" --n-samples "${SMOKE_SAMPLES}") > "$LOG_DIR/build_cnndm.log" 2>&1 || { err "Dataset generation failed (see $LOG_DIR/build_cnndm.log)"; sed -n '1,200p' "$LOG_DIR/build_cnndm.log" || true; exit 2; }
  # Select actual file if different name was produced
  if [[ ! -s "$DATASET_PATH" ]]; then
    cand=$(ls -1t "${RESULTS_DIR}/data"/cnn_eval*.json 2>/dev/null | head -1 || true)
    [[ -n "$cand" ]] && DATASET_PATH="$cand"
  fi
  [[ -s "$DATASET_PATH" ]] || { err "Dataset generation failed (see $LOG_DIR/build_cnndm.log)"; exit 2; }
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
    TORCHINDUCTOR_CACHE_DIR="${TORCHINDUCTOR_CACHE_DIR}" \
    MKL_THREADING_LAYER="${MKL_THREADING_LAYER}" \
    MKL_SERVICE_FORCE_INTEL="${MKL_SERVICE_FORCE_INTEL}" \
    python -u main.py \
      --scenario "$scenario" \
      --model-path "$CHECKPOINT_PATH" \
      --batch-size $([[ "${SMOKE_FAST}" == "1" ]] && echo 1 || echo 16) \
      $([[ "$mode" == "accuracy" ]] && echo "--accuracy") \
      --dtype "$DTYPE" \
      --vllm \
      --user-conf "${SMOKE_USER_CONF}" \
      --total-sample-count "${SMOKE_SAMPLES}" \
      --dataset-path "$DATASET_PATH" \
      --output-log-dir "$outdir" \
      --tensor-parallel-size "$GPU_COUNT"
  ) |& tee -a "$outdir/run.log"
}

generate_report_for_dir(){
  local outdir="$1"
  local prefer_json=""
  # Prefer our normalized summary first
  if [[ -f "${outdir}/summary.json" ]]; then
    prefer_json="${outdir}/summary.json"
  elif [[ -f "${outdir}/mlperf_log_summary.json" ]]; then
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
  python3 scripts/mlperf_postprocess.py --outdir "${out_srv_perf}" --app-dir "${APP_DIR}" --dataset "${DATASET_PATH}" --mode performance |& tee -a "${out_srv_perf}/post.log" || true
  generate_report_for_dir "${out_srv_perf}"
fi

# 2) Server accuracy → report
if [[ "${RUN_ACC_SERVER}" == "1" ]]; then
  out_srv_acc="${MLPERF_DIR}/server_accuracy"
  run_ref Server accuracy "${out_srv_acc}"
  python3 scripts/mlperf_postprocess.py --outdir "${out_srv_acc}" --app-dir "${APP_DIR}" --dataset "${DATASET_PATH}" --mode accuracy |& tee -a "${out_srv_acc}/post.log" || true
  generate_report_for_dir "${out_srv_acc}"
fi

# 3) Offline perf → report
if [[ "${RUN_PERF_OFFLINE}" == "1" ]]; then
  out_off_perf="${MLPERF_DIR}/offline_performance"
  run_ref Offline performance "${out_off_perf}"
  python3 scripts/mlperf_postprocess.py --outdir "${out_off_perf}" --app-dir "${APP_DIR}" --mode performance |& tee -a "${out_off_perf}/post.log" || true
  generate_report_for_dir "${out_off_perf}"
fi

# 4) Offline accuracy → report
if [[ "${RUN_ACC_OFFLINE}" == "1" ]]; then
  out_off_acc="${MLPERF_DIR}/offline_accuracy"
  run_ref Offline accuracy "${out_off_acc}"
  python3 scripts/mlperf_postprocess.py --outdir "${out_off_acc}" --app-dir "${APP_DIR}" --dataset "${DATASET_PATH}" --mode accuracy |& tee -a "${out_off_acc}/post.log" || true
  generate_report_for_dir "${out_off_acc}"
fi

# 5) MMLU → report
if [[ "${RUN_MMLU_SMOKE}" == "1" ]]; then
  log "MMLU smoke..."
  set +e
  python3 -m lm_eval --model vllm \
    --model_args "pretrained=${CHECKPOINT_PATH},dtype=${MMLU_DTYPE:-float16},tensor_parallel_size=${GPU_COUNT},gpu_memory_utilization=0.85,max_model_len=512,max_num_batched_tokens=512,max_num_seqs=1,enforce_eager=True,trust_remote_code=True" \
    --tasks mmlu_high_school_biology --batch_size ${MMLU_BATCH:-1} --num_fewshot 0 ${MMLU_LIMIT:+--limit ${MMLU_LIMIT}} \
    --output_path "${MMLU_DIR}" --log_samples |& tee -a "${MMLU_DIR}/lm_eval.log"
  MRC=${PIPESTATUS[0]}
  if [[ ${MRC} -ne 0 ]]; then
    err "MMLU failed; retrying with tighter memory: util=0.80, max_len=384"
    python3 -m lm_eval --model vllm \
      --model_args "pretrained=${CHECKPOINT_PATH},dtype=${MMLU_DTYPE:-float16},tensor_parallel_size=${GPU_COUNT},gpu_memory_utilization=0.80,max_model_len=384,max_num_batched_tokens=384,max_num_seqs=1,enforce_eager=True,trust_remote_code=True" \
      --tasks mmlu_high_school_biology --batch_size ${MMLU_BATCH:-1} --num_fewshot 0 ${MMLU_LIMIT:+--limit ${MMLU_LIMIT}} \
      --output_path "${MMLU_DIR}" --log_samples |& tee -a "${MMLU_DIR}/lm_eval.log"
  fi
  set -e
  # Find latest JSON produced by lm_eval (search recursively)
  mmlu_json="$(MMLU_DIR="${MMLU_DIR}" python3 - <<'PY'
import os, sys, glob
base=os.environ.get('MMLU_DIR','.')
candidates=[]
for root,dirs,files in os.walk(base):
    for fn in files:
        if fn.endswith('.json'):
            p=os.path.join(root,fn)
            try:
                candidates.append((os.path.getmtime(p), p))
            except Exception:
                pass
if candidates:
    candidates.sort(reverse=True)
    print(candidates[0][1])
else:
    print('')
PY
  )"
  # Normalize MMLU into summary.json for rollup/reporting
  if [[ -n "${mmlu_json}" ]]; then
    MMLU_SUMMARY_PATH="${MMLU_DIR}/summary.json"
    RESULTS_DIR_ENV="${RESULTS_DIR}" MMLU_DIR="${MMLU_DIR}" MMLU_JSON_PATH="${mmlu_json}" python3 - <<'PY'
import json, os, sys
src=os.environ.get('MMLU_JSON_PATH')
dst=os.path.join(os.environ.get('MMLU_DIR','.'),'summary.json')
try:
    with open(src,'r') as f:
        data=json.load(f)
except Exception:
    data={}
out={"metadata":{},"performance":{},"accuracy":{}}
# EleutherAI lm_eval results.json structure
if isinstance(data, dict) and 'results' in data:
    results=data.get('results',{})
    # Try to aggregate first task found
    if isinstance(results, dict) and results:
        first_task=sorted(results.keys())[0]
        task_res=results.get(first_task,{})
        # common keys: 'acc', 'acc_norm', sometimes nested dict {'acc': value}
        acc=None
        if isinstance(task_res, dict):
            if isinstance(task_res.get('acc'), dict):
                acc=task_res['acc'].get('value') if isinstance(task_res['acc'].get('value', None), (int,float)) else None
            if acc is None:
                acc = task_res.get('acc') or task_res.get('acc_norm') or task_res.get('acc,none')
        if acc is None:
            acc = 0
        out['accuracy']={'mmlu_acc': float(acc)}
        out['metadata']['task']=first_task
    # Add config bits
    cfg=data.get('config',{})
    if isinstance(cfg, dict):
        out['metadata']['num_fewshot']=cfg.get('num_fewshot',0)
        out['metadata']['batch_size']=cfg.get('batch_size',1)
        out['metadata']['limit']=cfg.get('limit')
    # Samples if available
    # Some versions include 'versions' or 'n-samples' info per task; skip if absent
else:
    # Fallback: leave as empty accuracy
    pass
try:
    with open(dst,'w') as f:
        json.dump(out,f,indent=2)
    print('Wrote', dst)
except Exception as e:
    print('Failed to write MMLU summary:', e)
PY
    # Generate MMLU report via dedicated generator if available, else fallback to generic
    if [[ -f "${ROOT_DIR}/generate_mmlu_report.py" ]]; then
      python3 "${ROOT_DIR}/generate_mmlu_report.py" "${MMLU_DIR}/summary.json" |& tee -a "${MMLU_DIR}/report.log" || true
    else
      python3 generate_report_from_json.py "${MMLU_DIR}/summary.json" |& tee -a "${MMLU_DIR}/report.log" || true
    fi
  fi
  # Aggregate simple rollup for the entire run
  rollup_dir="${RESULTS_DIR}/rollup"; mkdir -p "${rollup_dir}"
  python3 - <<'PY'
import json,glob,os,sys
res_dir=os.environ.get('RESULTS_DIR','results')
items=[]
for p in glob.glob(os.path.join(res_dir,'**','summary.json'),recursive=True):
    try:
        with open(p,'r') as f: items.append({'path':p,'data':json.load(f)})
    except Exception: pass
out={'count':len(items),'entries':items}
rollup=os.path.join(res_dir,'rollup','run_rollup.json')
os.makedirs(os.path.dirname(rollup),exist_ok=True)
with open(rollup,'w') as f: json.dump(out,f,indent=2)
print('Wrote',rollup)
PY
fi

log "Smoke complete → ${RESULTS_DIR}"
exit 0

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
mkdir -p "${RESULTS_DIR}" "${LOG_DIR}" "${MLPERF_DIR}" "${MMLU_DIR}" "${HF_HOME}" "${TORCHINDUCTOR_CACHE_DIR}"

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
CHECKPOINT_PATH=$(HF_HOME="${HF_HOME}" MODEL_ID="${MODEL_ID}" python3 - <<'PY'
import os,glob; r=os.environ.get("HF_HOME","."); m=os.environ["MODEL_ID"].replace('/','--')
c=sorted(glob.glob(os.path.join(r,f"models--{m}","snapshots","*")),key=os.path.getmtime,reverse=True)
print(c[0] if c else "")
PY
)
[[ -z "$CHECKPOINT_PATH" ]] && { err "Model not in cache"; exit 2; }

# Dataset (prefer sample-sized file name when SMOKE_SAMPLES > 0)
mkdir -p "${RESULTS_DIR}/data"
DATASET_BASENAME="cnn_eval.json"
if [[ -n "${SMOKE_SAMPLES}" && "${SMOKE_SAMPLES}" != "0" ]]; then
  DATASET_BASENAME="cnn_eval_${SMOKE_SAMPLES}.json"
fi
DATASET_PATH="${RESULTS_DIR}/data/${DATASET_BASENAME}"
if [[ ! -s "$DATASET_PATH" ]]; then
  log "Generating CNN/DM eval set..."
  (cd "$APP_DIR" && DATASET_CNNDM_PATH="${RESULTS_DIR}/data" python3 download_cnndm.py --model-id "$MODEL_ID" --n-samples "${SMOKE_SAMPLES}") > "$LOG_DIR/build_cnndm.log" 2>&1 || exit 2
  if [[ ! -s "$DATASET_PATH" ]]; then
    cand=$(ls -1t "${RESULTS_DIR}/data"/cnn_eval*.json 2>/dev/null | head -1 || true)
    [[ -n "$cand" ]] && DATASET_PATH="$cand"
  fi
  [[ -s "$DATASET_PATH" ]] || { err "Dataset generation failed (see $LOG_DIR/build_cnndm.log)"; exit 2; }
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

