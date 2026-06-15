#!/usr/bin/env bash
# scripts/lib/detect.sh — pure auto-detection functions for kcloud-tool installer
#
# Rules:
#  - Source this file; do NOT execute it directly.
#  - Every function echoes its result to stdout; all log output goes to stderr.
#  - No global state mutation; no secret values ever echoed to stdout.
#  - Degrade gracefully: emit a safe default + [warn] when something is absent.
#  - Requires lib/log.sh to be sourced first (falls back to plain echo if not).

[[ "${BASH_SOURCE[0]}" != "${0}" ]] || {
  echo "ERROR: source this file, do not execute it directly." >&2
  exit 1
}

# Ensure log helpers exist (fallback if log.sh not yet sourced)
if ! type log_warn &>/dev/null 2>&1; then
  log_warn()  { echo "[WARN ] $*" >&2; }
  log_info()  { echo "[INFO ] $*" >&2; }
  log_error() { echo "[ERROR] $*" >&2; }
fi

# ---------------------------------------------------------------------------
# detect_nodes_match <csv-of-ips>
#
# Compare a comma-separated list of IPs against the cluster's node InternalIPs.
# Echoes:
#   "ok"                       — all IPs found in cluster
#   "mismatch:<ip1>,<ip2>,..."  — one or more IPs not found
#   "unknown"                  — kubectl not reachable (non-fatal; caller decides)
# Returns: 0 ok, 1 mismatch, 2 kubectl error
# ---------------------------------------------------------------------------
detect_nodes_match() {
  local csv="${1:-}"
  if [[ -z "$csv" ]]; then
    log_warn "detect_nodes_match: no IPs provided"
    echo "mismatch:empty"
    return 1
  fi

  local cluster_ips
  if ! cluster_ips=$(kubectl get nodes \
      -o jsonpath='{range .items[*]}{.status.addresses[?(@.type=="InternalIP")].address}{"\n"}{end}' \
      2>/dev/null); then
    log_warn "detect_nodes_match: kubectl unavailable — skipping node IP validation"
    echo "unknown"
    return 2
  fi

  local -a requested mismatches=()
  IFS=',' read -ra requested <<< "$csv"
  for raw_ip in "${requested[@]}"; do
    local ip="${raw_ip// /}"   # strip whitespace
    if ! echo "$cluster_ips" | grep -qxF "$ip"; then
      mismatches+=("$ip")
    fi
  done

  if [[ ${#mismatches[@]} -eq 0 ]]; then
    echo "ok"
    return 0
  else
    local joined
    joined=$(IFS=','; echo "${mismatches[*]}")
    echo "mismatch:${joined}"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# detect_device_mode
#
# Scan node allocatable resources for known accelerators.
# Priority: gpu > npu-rngd > npu-atom > cpu
# Echoes: gpu | npu-rngd | npu-atom | cpu
# Returns: always 0
# ---------------------------------------------------------------------------
detect_device_mode() {
  local node_json
  if ! node_json=$(kubectl get nodes -o json 2>/dev/null); then
    log_warn "detect_device_mode: kubectl unavailable — defaulting to cpu"
    echo "cpu"
    return 0
  fi

  # Extract all allocatable resource keys from all nodes
  local alloc_keys
  alloc_keys=$(echo "$node_json" | \
    grep -o '"[a-zA-Z0-9./_-]*":[[:space:]]*"[0-9]*"' | \
    grep -o '"[a-zA-Z0-9./_-]*":' | tr -d '"':)

  if echo "$alloc_keys" | grep -q 'nvidia\.com/gpu'; then
    echo "gpu"
    return 0
  fi

  if echo "$alloc_keys" | grep -q 'furiosa\.ai/rngd'; then
    echo "npu-rngd"
    return 0
  fi

  if echo "$alloc_keys" | grep -q 'rebellions\.ai/ATOM'; then
    echo "npu-atom"
    return 0
  fi

  echo "cpu"
  return 0
}

# ---------------------------------------------------------------------------
# detect_device_resource <mode>
#
# Echo the Kubernetes resource key for a given device mode.
# Echoes: resource key string, or "" for cpu
# Returns: 0
# ---------------------------------------------------------------------------
detect_device_resource() {
  local mode="${1:-}"
  case "$mode" in
    gpu)      echo "nvidia.com/gpu" ;;
    npu-rngd) echo "furiosa.ai/rngd" ;;
    npu-atom) echo "rebellions.ai/ATOM" ;;
    cpu)      echo "" ;;
    *)
      log_warn "detect_device_resource: unknown mode '${mode}' — returning empty resource"
      echo ""
      ;;
  esac
  return 0
}

# ---------------------------------------------------------------------------
# detect_storage_class
#
# Prefer an RWX-capable class by nfs provisioner substring.
# MUST NOT rely on is-default-class annotation alone (two defaults exist in prod).
# Echoes: storage class name, or "" on total failure
# Returns: 0 on success, 1 on failure
# ---------------------------------------------------------------------------
detect_storage_class() {
  local sc_table
  if ! sc_table=$(kubectl get storageclass \
      -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.provisioner}{"\n"}{end}' \
      2>/dev/null); then
    log_warn "detect_storage_class: kubectl unavailable — no storage class detected"
    echo ""
    return 1
  fi

  # Prefer NFS provisioner (RWX capable)
  local nfs_classes
  nfs_classes=$(echo "$sc_table" | awk -F'\t' 'tolower($2) ~ /nfs/ {print $1}')
  local nfs_count
  nfs_count=$(echo "$nfs_classes" | grep -c '[^[:space:]]' 2>/dev/null || echo 0)

  if [[ "$nfs_count" -gt 1 ]]; then
    local first_nfs
    first_nfs=$(echo "$nfs_classes" | head -1)
    log_warn "detect_storage_class: multiple NFS storage classes found (using '${first_nfs}'); override with --storage-class if needed"
    echo "$first_nfs"
    return 0
  elif [[ "$nfs_count" -eq 1 ]]; then
    echo "$nfs_classes"
    return 0
  fi

  # Fall back to the first class annotated as default
  local default_class
  default_class=$(kubectl get storageclass \
    -o jsonpath='{range .items[*]}{.metadata.annotations.storageclass\.kubernetes\.io/is-default-class}{"\t"}{.metadata.name}{"\n"}{end}' \
    2>/dev/null | awk -F'\t' '$1 == "true" {print $2}' | head -1 || echo "")

  if [[ -n "$default_class" ]]; then
    log_warn "detect_storage_class: no NFS class found — falling back to default '${default_class}' (likely RWO only)"
    echo "$default_class"
    return 0
  fi

  log_warn "detect_storage_class: no usable storage class found — use --storage-class to specify one"
  echo ""
  return 1
}

# ---------------------------------------------------------------------------
# detect_pvc_access_mode <storage-class-name>
#
# Echoes: ReadWriteMany (nfs provisioner) | ReadWriteOnce (all others)
# Returns: 0
# ---------------------------------------------------------------------------
detect_pvc_access_mode() {
  local sc="${1:-}"
  if [[ -z "$sc" ]]; then
    echo "ReadWriteOnce"
    return 0
  fi

  local provisioner
  if ! provisioner=$(kubectl get storageclass "$sc" \
      -o jsonpath='{.provisioner}' 2>/dev/null); then
    log_warn "detect_pvc_access_mode: cannot query storageclass '${sc}' — defaulting to ReadWriteOnce"
    echo "ReadWriteOnce"
    return 0
  fi

  if [[ "$provisioner" == *"nfs"* ]]; then
    echo "ReadWriteMany"
  else
    echo "ReadWriteOnce"
  fi
  return 0
}

# ---------------------------------------------------------------------------
# detect_hf_secret [namespace]
#
# Probe for a HuggingFace token, in priority order:
#   1. env vars  HF_TOKEN / HUGGING_FACE_HUB_TOKEN
#   2. local file  ~/.cache/huggingface/token
#   3. in-cluster secret  huggingface-token  (target ns, then well-known ns)
#
# Echoes: env | file:<path> | secret:<ns>/<name> | ""
# NEVER echoes the token value itself.
# Returns: 0 if found, 1 if not found
# ---------------------------------------------------------------------------
detect_hf_secret() {
  local ns="${1:-}"

  # 1. Environment variables
  if [[ -n "${HF_TOKEN:-}" ]] || [[ -n "${HUGGING_FACE_HUB_TOKEN:-}" ]]; then
    echo "env"
    return 0
  fi

  # 2. Local file cache
  if [[ -f "${HOME}/.cache/huggingface/token" ]]; then
    echo "file:${HOME}/.cache/huggingface/token"
    return 0
  fi

  # 3. In-cluster secret — check target namespace first
  if [[ -n "$ns" ]]; then
    if kubectl get secret huggingface-token -n "$ns" &>/dev/null 2>&1; then
      echo "secret:${ns}/huggingface-token"
      return 0
    fi
  fi

  # 3b. Well-known namespaces where the secret is known to exist
  local wk_ns
  for wk_ns in llm-bench llm-evaluation; do
    if kubectl get secret huggingface-token -n "$wk_ns" &>/dev/null 2>&1; then
      echo "secret:${wk_ns}/huggingface-token"
      return 0
    fi
  done

  # Not found
  echo ""
  return 1
}

# ---------------------------------------------------------------------------
# detect_registry
#
# Infer a private registry prefix from images currently running in the cluster.
# Echoes: registry prefix (e.g. "registry.example.com:5000") or "" for public
# Returns: 0
# ---------------------------------------------------------------------------
detect_registry() {
  local images
  if ! images=$(kubectl get pods --all-namespaces \
      -o jsonpath='{range .items[*]}{range .spec.containers[*]}{.image}{"\n"}{end}{end}' \
      2>/dev/null); then
    echo ""
    return 0
  fi

  # A private registry has a hostname (contains dot or colon) before the first slash
  # and is NOT a well-known public registry.
  local registry
  registry=$(echo "$images" | sort -u | \
    grep -E '^[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)+[:/]' | \
    grep -vE '^(docker\.io|ghcr\.io|quay\.io|gcr\.io|k8s\.gcr\.io|registry\.k8s\.io)' | \
    grep -vE '^(vllm/|python:|nvcr\.io/nvidia/)' | \
    head -1 | \
    sed 's|/[^/].*$||' || echo "")

  echo "${registry:-}"
  return 0
}

# ---------------------------------------------------------------------------
# detect_operator_present <mode>
#
# Check whether the device operator OR raw device plugin is present for mode.
# Falls back gracefully: look for kcloud names first, then raw device resources.
# Only hard-fails when strict NPU mode is requested and nothing is found.
#
# Returns: 0 if present, 1 if absent
# ---------------------------------------------------------------------------
detect_operator_present() {
  local mode="${1:-}"

  case "$mode" in
    gpu)
      # kcloud-tool operator name (future) OR NVIDIA GPU operator OR raw plugin
      if kubectl get namespace kcloud-npu-operator &>/dev/null 2>&1; then
        return 0
      fi
      if kubectl get namespace gpu-operator &>/dev/null 2>&1; then
        return 0
      fi
      # Raw resource on any node is sufficient
      if kubectl get nodes -o json 2>/dev/null | grep -q '"nvidia\.com/gpu"'; then
        return 0
      fi
      log_warn "detect_operator_present: no GPU operator or device resource found for mode '${mode}'"
      return 1
      ;;

    npu-rngd)
      if kubectl get namespace kcloud-npu-operator &>/dev/null 2>&1; then
        return 0
      fi
      if kubectl get namespace furiosa-system &>/dev/null 2>&1; then
        return 0
      fi
      if kubectl get nodes -o json 2>/dev/null | grep -q '"furiosa\.ai/rngd"'; then
        return 0
      fi
      log_warn "detect_operator_present: no FuriosaAI RNGD operator or device resource found"
      return 1
      ;;

    npu-atom)
      if kubectl get namespace kcloud-npu-operator &>/dev/null 2>&1; then
        return 0
      fi
      if kubectl get namespace rbln-system &>/dev/null 2>&1; then
        return 0
      fi
      if kubectl get nodes -o json 2>/dev/null | grep -q '"rebellions\.ai/ATOM"'; then
        return 0
      fi
      log_warn "detect_operator_present: no Rebellions Atom+ operator or device resource found"
      return 1
      ;;

    cpu)
      # CPU mode needs no device operator
      return 0
      ;;

    *)
      log_warn "detect_operator_present: unknown mode '${mode}'"
      return 1
      ;;
  esac
}
