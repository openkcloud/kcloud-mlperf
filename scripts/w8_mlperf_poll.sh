#!/bin/bash
# W8 MLPerf polling monitor - checks all 4 hardware job statuses
# L40=#137 A40=#136 RNGD=#71 AtomPlus=#72 (node5 PID=1130314)
# Also handles log/result rsync to local paths for W15/W16 artifact access.

API="http://10.254.177.41:30980/api"
LOG="/home/kcloud/etri-llm-exam-solution/logs/benchmarks/w8_poll.log"
LOGS_DIR="/home/kcloud/etri-llm-exam-solution/logs/benchmarks"
RESULTS_DIR="/home/kcloud/etri-llm-exam-solution/results"
POLL=60
MAX_WAIT=86400  # 24h max (Atom+ takes ~34h but we log completion)
NODE5_KEY="$HOME/.ssh/id_ed25519_node5"
NODE5="kcloud@10.254.202.111"
ATOM_RUN_ID="atomplus-mlperf-full-20260506-020906"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S UTC')] $1" | tee -a "$LOG"; }

check_mp() {
  curl -s "$API/mp-exam/details/$1" 2>/dev/null | python3 -c "
import json,sys
d=json.load(sys.stdin)['data']
print(d['status'])
" 2>/dev/null || echo "ERROR"
}

check_npu() {
  curl -s "$API/npu-eval/details/$1" 2>/dev/null | python3 -c "
import json,sys
d=json.load(sys.stdin)['data']
print(d['status'])
" 2>/dev/null || echo "ERROR"
}

check_atomplus_pid() {
  ssh -i "$NODE5_KEY" -o StrictHostKeyChecking=no -o ConnectTimeout=5 \
    "$NODE5" "ps -p 1130314 -o pid= 2>/dev/null && echo alive || echo dead" 2>/dev/null || echo "ssh-error"
}

rsync_atomplus_log() {
  ssh -i "$NODE5_KEY" -o StrictHostKeyChecking=no -o ConnectTimeout=10 \
    "$NODE5" "cat /home/kcloud/atomplus_mlperf_full_20260506.out" 2>/dev/null \
    > "$LOGS_DIR/mlperf_atomplus_${ATOM_RUN_ID}.log"
}

rsync_atomplus_result() {
  rsync -az -e "ssh -i $NODE5_KEY -o StrictHostKeyChecking=no" \
    "${NODE5}:/home/kcloud/results/${ATOM_RUN_ID}/" \
    "$RESULTS_DIR/${ATOM_RUN_ID}/" 2>/dev/null
}

fetch_mp_result() {
  local id=$1 hw=$2
  local data
  data=$(curl -s "$API/mp-exam/details/$id" 2>/dev/null)
  local status tps tt100t vram
  status=$(echo "$data" | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['status'])" 2>/dev/null)
  if [ "$status" = "Completed" ]; then
    tps=$(echo "$data" | python3 -c "import json,sys; r=json.load(sys.stdin)['data']['results']; print(r[0]['result_perf_tps'] if r else 'no-results')" 2>/dev/null)
    tt100t=$(echo "$data" | python3 -c "import json,sys; r=json.load(sys.stdin)['data']['results']; print(r[0].get('result_tt100t') if r else 'no-results')" 2>/dev/null)
    vram=$(echo "$data" | python3 -c "import json,sys; r=json.load(sys.stdin)['data']['results']; print(r[0].get('result_vram_peak') if r else 'no-results')" 2>/dev/null)
    log "  $hw COMPLETED: tps=$tps tt100t=${tt100t}s vram=${vram}GB"
    # Write local result.json
    local ts
    ts=$(date -u +%Y%m%d-%H%M%S)
    local result_dir="$RESULTS_DIR/mlperf_${hw,,}_${ts}"
    mkdir -p "$result_dir"
    echo "$data" | python3 -c "
import json,sys,os
d=json.load(sys.stdin)['data']
r=d['results'][0] if d['results'] else {}
hw='$hw'
ts='$ts'
result={
  'run_id': f'mlperf-{hw.lower()}-{ts}',
  'hardware': hw,
  'vendor': 'nvidia',
  'benchmark': 'mlperf',
  'model': d['model'],
  'precision': d['precision'],
  'started_at': d['started_at'],
  'completed_at': d['end_at'],
  'status': 'completed',
  'failure_reason': None,
  'tt100t_seconds': r.get('result_tt100t'),
  'elapsed_seconds': 0,
  'throughput_tokens_per_sec': r.get('result_perf_tps'),
  'raw_metrics': {
    'result_perf_tps': r.get('result_perf_tps'),
    'result_perf_sps': r.get('result_perf_sps'),
    'result_perf_tps_best': r.get('result_perf_tps_best'),
    'result_perf_sps_best': r.get('result_perf_sps_best'),
    'result_perf_valid': r.get('result_perf_valid'),
    'result_perf_latency': r.get('result_perf_latency'),
    'result_perf_serv_ttft': r.get('result_perf_serv_ttft'),
    'result_perf_serv_tpot': r.get('result_perf_serv_tpot'),
    'result_acc_rg_1': r.get('result_acc_rg_1'),
    'result_acc_rg_2': r.get('result_acc_rg_2'),
    'result_acc_rg_l': r.get('result_acc_rg_l'),
    'result_acc_rg_lsum': r.get('result_acc_rg_lsum'),
    'result_acc_total': r.get('result_acc_total'),
    'result_vram_peak': r.get('result_vram_peak'),
    'result_gpu_util': r.get('result_gpu_util'),
  },
  'logs_path': f'results/mlperf_{hw.lower()}_{ts}/',
  'artifact_path': f'results/mlperf_{hw.lower()}_{ts}/exam_result.zip',
  'config_fingerprint': 'unfingerprinted',
}
with open('$result_dir/result.json','w') as f:
    json.dump(result,f,indent=2)
print(f'result.json written to $result_dir')
" 2>/dev/null
    # Copy log from pod if still available
    kubectl logs -n llm-evaluation -l "job-name=mlperf-${id}-1-1" --tail=10000 2>/dev/null \
      > "$LOGS_DIR/mlperf_${hw,,}_${ts}.log" || true
  fi
}

log "=== W8 MLPerf Poll Monitor Started ==="
log "L40=#137 A40=#136 RNGD=#71 AtomPlus=#72 (node5 PID=1130314)"

elapsed=0
L40_done=false; A40_done=false; RNGD_done=false; ATOM_done=false

while [ $elapsed -lt $MAX_WAIT ]; do

  # --- L40 ---
  if ! $L40_done; then
    L40=$(check_mp 137)
    case "$L40" in
      Completed) fetch_mp_result 137 "L40"; L40_done=true ;;
      Failed|Stopped|Error) log "L40#137 FAILED: $L40"; L40_done=true ;;
    esac
  fi

  # --- A40 ---
  if ! $A40_done; then
    A40=$(check_mp 136)
    case "$A40" in
      Completed) fetch_mp_result 136 "A40"; A40_done=true ;;
      Failed|Stopped|Error) log "A40#136 FAILED: $A40"; A40_done=true ;;
    esac
  fi

  # --- RNGD ---
  if ! $RNGD_done; then
    RNGD=$(check_npu 71)
    case "$RNGD" in
      Completed)
        log "RNGD#71 COMPLETED"
        RNGD_done=true
        # Fetch RNGD result from API
        curl -s "$API/npu-eval/details/71" 2>/dev/null | python3 -c "
import json,sys,os
d=json.load(sys.stdin)['data']
r=d['results'][0] if d.get('results') else {}
ts='$(date -u +%Y%m%d-%H%M%S)'
result_dir='/home/kcloud/etri-llm-exam-solution/results/mlperf_rngd_'+ts
os.makedirs(result_dir,exist_ok=True)
result={
  'run_id': 'mlperf-rngd-'+ts,
  'hardware': 'FuriosaAI-RNGD',
  'vendor': 'furiosa',
  'benchmark': 'mlperf',
  'model': d['model'],
  'precision': d['precision'],
  'started_at': d['started_at'],
  'completed_at': d['end_at'] or d['modified_at'],
  'status': 'completed',
  'failure_reason': None,
  'tt100t_seconds': r.get('result_tt100t'),
  'elapsed_seconds': 0,
  'throughput_tokens_per_sec': r.get('result_perf_tps'),
  'raw_metrics': {k:v for k,v in r.items() if k.startswith('result_')},
  'logs_path': 'logs/benchmarks/mlperf_rngd_'+ts+'.log',
  'artifact_path': result_dir+'/result.json',
  'config_fingerprint': 'unfingerprinted',
}
with open(result_dir+'/result.json','w') as f:
    json.dump(result,f,indent=2)
print('RNGD result written to '+result_dir)
" 2>/dev/null
        ;;
      Failed|Stopped|Error) log "RNGD#71 FAILED: $RNGD"; RNGD_done=true ;;
    esac
  fi

  # --- Atom+ ---
  if ! $ATOM_done; then
    ATOM_DB=$(check_npu 72)
    ATOM_PID=$(check_atomplus_pid)
    # Rsync log every iteration
    rsync_atomplus_log
    rsync_atomplus_result
    case "$ATOM_DB" in
      Completed)
        log "Atom+#72 COMPLETED (DB status)"
        rsync_atomplus_log
        rsync_atomplus_result
        ATOM_done=true
        ;;
      Failed|Stopped|Error)
        log "Atom+#72 FAILED: $ATOM_DB"
        rsync_atomplus_log
        rsync_atomplus_result
        ATOM_done=true
        ;;
      *)
        if [ "$ATOM_PID" = "dead" ]; then
          log "Atom+#72 PID=1130314 DEAD but DB=$ATOM_DB — checking result"
          rsync_atomplus_log
          rsync_atomplus_result
          # Check if result.json was written (success) or not (failure)
          if ssh -i "$NODE5_KEY" -o StrictHostKeyChecking=no "$NODE5" \
              "test -f /home/kcloud/results/${ATOM_RUN_ID}/result.json && echo exists" 2>/dev/null | grep -q exists; then
            log "Atom+ result.json found on node5 — marking completed"
            ATOM_done=true
          else
            log "Atom+ PID dead, no result.json — marking FAILED"
            ATOM_done=true
          fi
        fi
        ;;
    esac
  fi

  # Status line
  L40_s=$($L40_done && echo "DONE" || check_mp 137)
  A40_s=$($A40_done && echo "DONE" || check_mp 136)
  RNGD_s=$($RNGD_done && echo "DONE" || check_npu 71)
  ATOM_s=$($ATOM_done && echo "DONE" || check_npu 72)
  log "STATUS | L40#137=$L40_s | A40#136=$A40_s | RNGD#71=$RNGD_s | Atom+#72=$ATOM_s | elapsed=${elapsed}s"

  if $L40_done && $A40_done && $RNGD_done && $ATOM_done; then
    log "=== ALL 4 HARDWARE RUNS TERMINAL ==="
    exit 0
  fi

  sleep $POLL
  elapsed=$((elapsed + POLL))
done

log "=== POLL TIMEOUT after ${MAX_WAIT}s ==="
exit 1
