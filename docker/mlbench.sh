#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
mlbench <command> [options]

Commands:
  run            Run a benchmark or a smoke test.
  help           Show this help.

Run options:
  --host-model <path>   Path (inside container) to the model dir (required)
  --run-id <id>         Run ID (optional; default: timestamp)
  [-- ...]              Extra args passed through to a custom script if found

Behavior:
- If /app/scripts/run_benchmark.sh exists, mlbench will exec it with
  --host-model and --run-id (plus any extra args).
- Otherwise it performs a quick GPU-only smoke test: loads the model and
  generates a short response, writing outputs under /app/results/<RUN_ID>.

Notes:
- A CUDA-capable GPU must be available for the smoke test or most benchmarks.
USAGE
}

have_gpu() {
  python3 - <<'PY'
import sys
try:
    import torch
    sys.exit(0 if torch.cuda.is_available() else 2)
except Exception:
    sys.exit(3)
PY
}

ensure_pkg() {
  local mod="$1"; shift
  local pip_pkg="${1:-$mod}"
  python3 - <<PY || pip3 install --no-cache-dir "$pip_pkg"
import importlib, sys
sys.exit(0 if importlib.util.find_spec("$mod") else 1)
PY
}

cmd="${1:-help}"
case "$cmd" in
  help|-h|--help)
    usage
    ;;

  run)
    shift
    HOST_MODEL=""
    RUN_ID="$(date +%Y%m%d-%H%M%S)"
    EXTRA_ARGS=()

    while [[ $# -gt 0 ]]; do
      case "$1" in
        --host-model) HOST_MODEL="${2:-}"; shift 2 ;;
        --run-id)     RUN_ID="${2:-}"; shift 2 ;;
        --)           shift; EXTRA_ARGS+=("$@"); break ;;
        *)            EXTRA_ARGS+=("$1"); shift ;;
      esac
    done

    if [[ -z "${HOST_MODEL}" ]]; then
      echo "[ERROR] --host-model is required." >&2
      usage
      exit 1
    fi
    if [[ ! -d "${HOST_MODEL}" ]]; then
      echo "[ERROR] Model directory not found: ${HOST_MODEL}" >&2
      exit 1
    fi

    RESULTS_ROOT="/app/results"
    OUTDIR="${RESULTS_ROOT}/${RUN_ID}"
    mkdir -p "${OUTDIR}"

    # GPU check
    if ! have_gpu; then
      echo "[ERROR] No CUDA GPU visible in the container." >&2
      echo "        Install NVIDIA drivers + NVIDIA Container Toolkit, and run with '--gpus all'." >&2
      echo "        Docs: https://docs.nvidia.com/datacenter/cloud-native/" >&2
      exit 1
    fi

    # If a project-specific benchmark script exists, use it.
    if [[ -x "/app/scripts/run_benchmark.sh" ]]; then
      echo "[INFO] Using custom benchmark: /app/scripts/run_benchmark.sh"
      exec /app/scripts/run_benchmark.sh \
        --host-model "${HOST_MODEL}" \
        --run-id "${RUN_ID}" \
        "${EXTRA_ARGS[@]}"
    fi

    echo "[INFO] No custom benchmark found; running GPU smoke test."
    echo "[INFO] Output dir: ${OUTDIR}"

    # Make sure commonly needed bits are present
    ensure_pkg "accelerate" "accelerate>=0.31.0" >/dev/null
    ensure_pkg "transformers" >/dev/null

    # MAX_TOKENS env (defaults to 64 if unset)
    : "${MAX_TOKENS:=64}"

    # Simple generation smoke test (GPU)
    HMODEL="${HOST_MODEL}" OUTDIR="${OUTDIR}" MTOKENS="${MAX_TOKENS}" RUN_ID="${RUN_ID}" \
    python3 - <<'PY'
import os, json, time
from transformers import AutoTokenizer, AutoModelForCausalLM
import torch

model_dir = os.environ["HMODEL"]
outdir = os.environ["OUTDIR"]
max_new = int(os.environ.get("MTOKENS","64"))
os.makedirs(outdir, exist_ok=True)

print(f"[INFO] Loading model from: {model_dir}")
tokenizer = AutoTokenizer.from_pretrained(model_dir, use_fast=True)
model = AutoModelForCausalLM.from_pretrained(
    model_dir,
    torch_dtype=torch.float16,
).to("cuda")

prompt = "You are a helpful assistant. Say hello in one short sentence."
inputs = tokenizer(prompt, return_tensors="pt").to("cuda")

with torch.no_grad():
    out = model.generate(**inputs, max_new_tokens=max_new, do_sample=False)

text = tokenizer.decode(out[0], skip_special_tokens=True)

with open(os.path.join(outdir, "smoke_output.txt"), "w", encoding="utf-8") as f:
    f.write(text)

meta = {
    "run_id": os.environ.get("RUN_ID"),
    "model_dir": model_dir,
    "max_new_tokens": max_new,
    "timestamp": time.time(),
    "device": "cuda",
}
with open(os.path.join(outdir, "metadata.json"), "w", encoding="utf-8") as f:
    json.dump(meta, f, indent=2)

print("[OK] Smoke test complete.")
print(f"[OK]   -> {os.path.join(outdir, 'smoke_output.txt')}")
print(f"[OK]   -> {os.path.join(outdir, 'metadata.json')}")
PY
    ;;

  *)
    echo "[ERROR] Unknown subcommand: ${cmd}" >&2
    usage
    exit 1
    ;;
esac
