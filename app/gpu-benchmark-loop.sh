#!/bin/bash
# GPU Benchmark Continuous Improvement Loop
# Polls current benchmarks (#91-96, #30-31) until all finish,
# then triggers the multi-agent improvement loop via Claude Code.
#
# Usage: nohup bash gpu-benchmark-loop.sh &

API="http://10.254.177.41:30980/api"
LOG="/home/kcloud/etri-llm-exam-solution/.omc/logs/gpu-loop-poll.log"
PLAN="/home/kcloud/etri-llm-exam-solution/.omc/plans/ralplan-gpu-benchmark-loop.md"

MP_EXAMS="91 92 93 94 95 96"
MM_EXAMS="30 31"
TERMINAL_RE="Completed|Error|Stopped|Undefined|Terminating"
MAX_WAIT=14400  # 4 hours max
POLL_INTERVAL=60

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG"; }

log "=== GPU Benchmark Poll Loop Started ==="
log "Monitoring MLPerf exams: $MP_EXAMS"
log "Monitoring MMLU exams: $MM_EXAMS"
log "Poll interval: ${POLL_INTERVAL}s, Max wait: ${MAX_WAIT}s"

elapsed=0
while [ $elapsed -lt $MAX_WAIT ]; do
  all_done=true

  for id in $MP_EXAMS; do
    status=$(curl -s "$API/mp-exam/details/$id" 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['status'])" 2>/dev/null)
    if ! echo "$status" | grep -qE "$TERMINAL_RE"; then
      all_done=false
      log "  MP#$id: $status (still running)"
    else
      log "  MP#$id: $status"
    fi
  done

  for id in $MM_EXAMS; do
    status=$(curl -s "$API/mm-exam/details/$id" 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['status'])" 2>/dev/null)
    if ! echo "$status" | grep -qE "$TERMINAL_RE"; then
      all_done=false
      log "  MM#$id: $status (still running)"
    else
      log "  MM#$id: $status"
    fi
  done

  if $all_done; then
    log ""
    log "=== ALL BENCHMARKS COMPLETE ==="
    log "Triggering multi-agent improvement loop..."

    # Write trigger file for Claude Code to pick up
    cat > /home/kcloud/etri-llm-exam-solution/.omc/state/gpu-loop-trigger.json <<EOF
{
  "triggered_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "plan": "$PLAN",
  "mp_exams": [$(echo $MP_EXAMS | tr ' ' ',')],
  "mm_exams": [$(echo $MM_EXAMS | tr ' ' ',')],
  "status": "ready"
}
EOF
    log "Trigger file written. Ready for multi-agent loop."
    exit 0
  fi

  log "--- Waiting ${POLL_INTERVAL}s (${elapsed}s / ${MAX_WAIT}s elapsed) ---"
  sleep $POLL_INTERVAL
  elapsed=$((elapsed + POLL_INTERVAL))
done

log "=== TIMEOUT after ${MAX_WAIT}s ==="
log "Some exams did not finish. Proceeding anyway."
exit 1
