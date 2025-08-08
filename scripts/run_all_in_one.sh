#!/usr/bin/env bash
# scripts/run_all_in_one.sh
# Docker-only pipeline: build image → HF login (inside container) → MLPerf → MMLU → Report

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

IMAGE_NAME="${IMAGE_NAME:-mlbench}"
DOCKERFILE="${DOCKERFILE:-docker/Dockerfile}"

# --- sanity checks -----------------------------------------------------------
command -v docker >/dev/null 2>&1 || { echo "[ERROR] docker not found"; exit 1; }

if [[ ! -f .env ]]; then
  echo "[ERROR] .env file missing at project root."
  echo "Create it (see .env.sample) and set HF_TOKEN=... (or HUGGINGFACE_TOKEN=...)."
  exit 2
fi

if ! grep -Eq '^(HF_TOKEN|HUGGINGFACE_TOKEN)=' .env; then
  echo "[ERROR] Neither HF_TOKEN nor HUGGINGFACE_TOKEN found in .env"
  exit 2
fi

mkdir -p results .cache

RUN_ID="${RUN_ID:-$(date +%Y%m%d-%H%M%S)}"
echo "[INFO] RUN_ID=${RUN_ID}"
echo "[INFO] Building image: ${IMAGE_NAME} (Dockerfile: ${DOCKERFILE})"

docker build -t "${IMAGE_NAME}" -f "${DOCKERFILE}" . | cat

# --- shared docker args ------------------------------------------------------
DOCKER_GPU_ARGS=(--gpus all)        # remove or edit if you want CPU-only
DOCKER_MOUNTS=(-v "$PWD/results":/app/results -v "$PWD/.cache":/app/.cache)
DOCKER_ENV=(--env-file .env -e RUN_ID="${RUN_ID}")
DOCKER_WORKDIR=(-w /app)

# --- login snippet executed INSIDE the container -----------------------------
# We do a non-interactive HF login, validate access to the gated repo, and proceed.
read -r -d '' LOGIN_SNIPPET <<'EOS' || true
set -Eeuo pipefail
export HF_TOKEN="${HF_TOKEN:-${HUGGINGFACE_TOKEN:-}}"
: "${HF_TOKEN:?Missing HF_TOKEN inside container}"

# Ensure CLI exists and Git LFS is active
python -m pip -q install "huggingface_hub>=0.23" >/dev/null 2>&1 || true
git lfs install || true
git config --global credential.helper store || true

# Prefer the new CLI
if command -v hf >/dev/null 2>&1; then
  hf auth login --token "$HF_TOKEN" --add-to-git-credential || true
else
  huggingface-cli login --token "$HF_TOKEN" --add-to-git-credential || true
fi


# Quick connectivity/access check (no weight download)
git ls-remote https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct >/dev/null
EOS

# Small helper to run a one-off command in the container after HF login
run_in_container() {
  local cmd="$1"
  docker run --rm "${DOCKER_GPU_ARGS[@]}" "${DOCKER_ENV[@]}" "${DOCKER_MOUNTS[@]}" \
    "${DOCKER_WORKDIR[@]}" --entrypoint bash "${IMAGE_NAME}" -lc \
    "${LOGIN_SNIPPET} && echo '[INFO] ↳ ${cmd}' && ${cmd}"
}

echo "[INFO] Running MLPerf (accuracy)..."
run_in_container 'mlbench mlperf --run-id "$RUN_ID" --accuracy'

echo "[INFO] Running MMLU (5-shot by default)..."
run_in_container 'mlbench mmlu --run-id "$RUN_ID" --shots 5'

echo "[INFO] Generating consolidated report..."
# Report usually doesn’t need GPU, but keeping the same runner is simpler
run_in_container 'mlbench report --run-id "$RUN_ID"'

echo "[DONE] Artifacts:"
echo " - Results directory: $PWD/results/${RUN_ID}"
ls -la "results/${RUN_ID}" 2>/dev/null || true
