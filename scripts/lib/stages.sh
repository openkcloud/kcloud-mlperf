#!/usr/bin/env bash
# scripts/lib/stages.sh — full-stack installer stage functions for kcloud-tool
#
# Sourced by scripts/install_kcloud_stack.sh. Do NOT execute directly.
#
# Each stage is a function `stage_<name>()`. Stages honour the resolved globals
# exported by the orchestrator (NODE_IPS, CONTROL_PLANE_IP, ACCESS_IP, NFS_SERVER,
# NFS_PATH, APP_NAMESPACE, BENCH_NAMESPACE, SSH_PORT_CP, SSH_PORT_NPU,
# FRONTEND_NODEPORT, BACKEND_NODEPORT, MANAGED_BY, PART_OF, DEVICE_MODE, TIMEOUT,
# PLATFORM_DIR, RENDER_DIR, OPT_DRY_RUN, OPT_FORCE, CLUSTER_OFFLINE).
#
# Discipline (mirrors scripts/install_pilot_k8s.sh):
#  - Reuse lib/log.sh + lib/detect.sh helpers.
#  - SAFE BY DEFAULT: under OPT_DRY_RUN nothing mutates the cluster.
#  - Idempotent: helm upgrade --install; kubectl apply; create-if-absent namespaces.
#  - NEVER print secret values; redact to *** / [REDACTED:...].
#  - Work on COPIES under RENDER_DIR; never edit the upstream PLATFORM_DIR.

[[ "${BASH_SOURCE[0]}" != "${0}" ]] || {
  echo "ERROR: source this file, do not execute it directly." >&2
  exit 1
}

# Fallback log helpers (in case sourced before log.sh — should not happen)
if ! type log_info &>/dev/null 2>&1; then
  log_info()  { echo "[INFO ] $*" >&2; }
  log_warn()  { echo "[WARN ] $*" >&2; }
  log_error() { echo "[ERROR] $*" >&2; }
  log_step()  { echo "[STEP ] $*" >&2; }
fi

# ---------------------------------------------------------------------------
# Forbidden / allowed IP policy
# ---------------------------------------------------------------------------
# FORBIDDEN_OLD_IPS — old-cluster IPs that must NEVER appear in a rendered
# kubespray inventory or in stage-rendered artifacts for the NEW cluster. These
# are node1/node2/node3 of the departing dev cluster.
STAGES_FORBIDDEN_OLD_IPS=( 10.254.177.41 10.254.184.195 10.254.184.196 )

# _stages_ip_in_csv <ip> <csv> — true (0) if <ip> is one of the comma-separated
# tokens in <csv> (whitespace tolerant). Read-only.
_stages_ip_in_csv() {
  local needle="$1" csv="$2"
  local -a toks
  IFS=',' read -ra toks <<< "$csv"
  local t
  for t in "${toks[@]}"; do
    t="${t// /}"
    [[ -n "$t" && "$t" == "$needle" ]] && return 0
  done
  return 1
}

# _stages_ip_allowed <ip> — true (0) when <ip> is a LEGITIMATE address for the
# NEW cluster: it is one of the operator-supplied --node-ips, or the resolved
# --access-ip / --nfs-server. Used by the leak guards so the new cluster's own
# node IPs (including node4=10.254.202.114 and node5=10.254.202.111) are never
# false-positive-rejected. Only addresses that are NEITHER supplied NOR expected
# get rejected.
_stages_ip_allowed() {
  local ip="$1"
  _stages_ip_in_csv "$ip" "${NODE_IPS:-}" && return 0
  [[ -n "${ACCESS_IP:-}"  && "$ip" == "${ACCESS_IP}"  ]] && return 0
  [[ -n "${NFS_SERVER:-}" && "$ip" == "${NFS_SERVER}" ]] && return 0
  [[ -n "${CONTROL_PLANE_IP:-}" && "$ip" == "${CONTROL_PLANE_IP}" ]] && return 0
  return 1
}

# _stages_scan_forbidden_ips <file> — scan a rendered file for any FORBIDDEN old
# IP that is NOT also a legitimate supplied/expected IP. Echoes the first
# offending IP and returns 1; returns 0 (silent) when clean. Read-only.
_stages_scan_forbidden_ips() {
  local f="$1" ip
  [[ -f "$f" ]] || return 0
  for ip in "${STAGES_FORBIDDEN_OLD_IPS[@]}"; do
    if grep -qF "$ip" "$f" 2>/dev/null; then
      # A forbidden old IP that the operator did NOT legitimately supply is a leak.
      if ! _stages_ip_allowed "$ip"; then
        printf '%s' "$ip"
        return 1
      fi
    fi
  done
  return 0
}

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

# stages_dryrun_active — true when we must not mutate the cluster.
stages_dryrun_active() {
  [[ "${OPT_DRY_RUN:-false}" == "true" ]]
}

# stages_cluster_online — true when a cluster is reachable (and not offline-dryrun).
stages_cluster_online() {
  [[ "${CLUSTER_OFFLINE:-false}" != "true" ]]
}

# _stage_banner <name> <description>
_stage_banner() {
  log_step "================================================================"
  log_step "STAGE: $1 — $2"
  log_step "================================================================"
}

# _helm_install <release> <chart-dir> <namespace> [extra args...]
# Idempotent helm upgrade --install. Honours dry-run (helm template only) and
# offline degradation. Always creates the namespace declaratively first.
_helm_install() {
  local release="$1" chart="$2" ns="$3"
  shift 3
  local extra=( "$@" )

  if [[ ! -d "$chart" ]]; then
    log_error "Helm chart directory not found: ${chart}"
    return 1
  fi

  if stages_dryrun_active; then
    if ! stages_cluster_online; then
      log_info "[dry-run/offline] would 'helm upgrade --install ${release}' from ${chart} -n ${ns} (template skipped — no cluster)"
      return 0
    fi
    log_info "[dry-run] helm template ${release} (${chart}) -n ${ns}"
    if helm template "$release" "$chart" --namespace "$ns" "${extra[@]}" >/dev/null 2>"${RENDER_DIR}/helm-template-${release}.err"; then
      log_info "[dry-run] helm template ${release} OK"
    else
      log_warn "[dry-run] helm template ${release} produced errors (see ${RENDER_DIR}/helm-template-${release}.err)"
    fi
    return 0
  fi

  # _ensure_namespace owns creation + ownership annotation. Do NOT pass
  # --create-namespace (that would create an unannotated ns, defeating the
  # safe-ownership / cleanup model).
  _ensure_namespace "$ns"
  log_info "helm upgrade --install ${release} (${chart}) -n ${ns}"
  helm upgrade --install "$release" "$chart" \
    --namespace "$ns" \
    --wait \
    --timeout "${TIMEOUT:-600}s" \
    "${extra[@]}"
}

# _ensure_namespace <ns> — create-if-absent. SAFE OWNERSHIP MODEL:
#   * If the namespace ALREADY EXISTS, we do NOT claim it: no managed-by stamp and
#     no created annotation. We just use it (so cleanup never deletes a shared /
#     pre-existing production namespace like llm-evaluation).
#   * If WE create it, we label managed-by + part-of AND set the annotation
#     kcloud-tool/created="true". That annotation (set ONLY at creation) is the
#     deletion key honoured by run_cleanup.
# Idempotent. Honours dry-run / offline guards.
_ensure_namespace() {
  local ns="$1"
  if stages_dryrun_active; then
    log_info "[dry-run] would ensure namespace ${ns} (claim+annotate kcloud-tool/created only if WE create it)"
    return 0
  fi
  if ! stages_cluster_online; then
    log_info "[offline] skipping namespace ensure for ${ns} (no cluster)"
    return 0
  fi

  if kubectl get namespace "$ns" &>/dev/null; then
    log_info "Using existing namespace ${ns} (not claiming ownership; cleanup will not delete it)"
    return 0
  fi

  log_info "Creating namespace ${ns} (will be owned + annotated kcloud-tool/created=true)"
  if ! kubectl create namespace "$ns" >/dev/null 2>&1; then
    # Lost a race (created concurrently) — treat as pre-existing, do not claim.
    log_warn "Namespace ${ns} appeared concurrently — using it without claiming ownership"
    return 0
  fi
  kubectl label namespace "$ns" \
    "app.kubernetes.io/managed-by=${MANAGED_BY:-kcloud-tool}" \
    "app.kubernetes.io/part-of=${PART_OF:-kcloud-stack}" \
    --overwrite >/dev/null 2>&1 || true
  kubectl annotate namespace "$ns" \
    "kcloud-tool/created=true" \
    --overwrite >/dev/null 2>&1 || true
}

# _deploy_exists <name> <ns> — true if a Deployment exists. Read-only.
_deploy_exists() {
  local name="$1" ns="$2"
  kubectl get deploy "$name" -n "$ns" &>/dev/null
}

# _wait_rollout <kind/name> <ns> — best-effort rollout wait; warn (not fail) on timeout
# unless required. Guards on Deployment existence first (clear message if absent).
# Returns 0 on success / dry-run / offline, 1 on real failure / missing target.
_wait_rollout() {
  local target="$1" ns="$2"
  if stages_dryrun_active || ! stages_cluster_online; then
    log_info "[dry-run] would wait for rollout: ${target} -n ${ns}"
    return 0
  fi
  # Existence guard for deployment/<name> targets.
  if [[ "$target" == deployment/* || "$target" == deploy/* ]]; then
    local dname="${target#*/}"
    if ! _deploy_exists "$dname" "$ns"; then
      log_warn "Deployment '${dname}' not found in namespace ${ns} — skipping rollout wait (chart may use a different name)."
      return 1
    fi
  fi
  if kubectl -n "$ns" rollout status "$target" --timeout="${TIMEOUT:-600}s" >/dev/null 2>&1; then
    log_info "Rollout ready: ${target} -n ${ns}"
    return 0
  fi
  log_warn "Rollout not ready within ${TIMEOUT:-600}s: ${target} -n ${ns}"
  return 1
}

# _http_status <url> — echo HTTP status code (000 on failure). Read-only.
_http_status() {
  local url="$1"
  curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$url" 2>/dev/null || echo "000"
}

# ---------------------------------------------------------------------------
# stage_preflight
# Tooling check; cluster reachability; node-IP↔InternalIP match; resolve roles
# (control-plane, nfs-server, access-ip); resolve device mode. Degrades to a
# printed plan when offline under --dry-run.
# ---------------------------------------------------------------------------
stage_preflight() {
  _stage_banner preflight "tooling, cluster reachability, role + device resolution"

  # 1. Tooling
  local missing=()
  local t
  for t in kubectl helm envsubst jq curl; do
    command -v "$t" >/dev/null 2>&1 || missing+=("$t")
  done
  if [[ ${#missing[@]} -gt 0 ]]; then
    log_error "Missing required tools: ${missing[*]}"
    log_error "Install them and re-run. (kubectl, helm, envsubst, jq, curl are required.)"
    return 1
  fi
  log_info "Tooling present: kubectl helm envsubst jq curl"

  # 2. Cluster reachability
  if kubectl cluster-info &>/dev/null; then
    CLUSTER_OFFLINE=false
    log_info "Cluster is reachable"
  else
    if stages_dryrun_active || [[ "${OPT_VALIDATE_ONLY:-false}" == "true" ]]; then
      CLUSTER_OFFLINE=true
      log_warn "Cluster not reachable — degrading to offline preview (no live detection / no mutation)."
    else
      log_error "Cluster not reachable. Check KUBECONFIG / cluster state."
      return 1
    fi
  fi

  # 3. Node IP ↔ InternalIP match (warn unless a real apply is requested)
  if stages_cluster_online; then
    local node_result
    node_result=$(detect_nodes_match "$NODE_IPS")
    case "$node_result" in
      ok)
        log_info "All node IPs matched in cluster"
        ;;
      unknown)
        log_warn "Could not validate node IPs (kubectl error) — proceeding with caution"
        ;;
      mismatch:*)
        local bad="${node_result#mismatch:}"
        local is_mutating=true
        { stages_dryrun_active || [[ "${OPT_VALIDATE_ONLY:-false}" == "true" ]]; } && is_mutating=false
        if [[ "$is_mutating" == "true" && "${OPT_FORCE:-false}" != "true" ]]; then
          log_error "Node IP mismatch — IPs not found in cluster: ${bad}"
          log_error "Use --force to proceed anyway, or verify your --node-ips value."
          return 1
        fi
        log_warn "Node IP mismatch (not found: ${bad}) — continuing"
        ;;
    esac
  else
    log_warn "Offline: skipping node-IP validation"
  fi

  # 4. Resolve device mode
  if [[ "${DEVICE_ARG:-auto}" == "auto" ]]; then
    if stages_cluster_online; then
      DEVICE_MODE=$(detect_device_mode)
      log_info "Auto-detected device mode: ${DEVICE_MODE}"
    else
      DEVICE_MODE="cpu"
      log_warn "Offline: device auto-detect unavailable; plan defaults to 'cpu' (override with --device)."
    fi
  else
    DEVICE_MODE="${DEVICE_ARG}"
    log_info "Using specified device mode: ${DEVICE_MODE}"
  fi
  export DEVICE_MODE

  # 5. Role / IP echo (resolved by orchestrator; we just report them)
  log_info "Control-plane IP:  ${CONTROL_PLANE_IP}"
  log_info "Access IP:         ${ACCESS_IP}"
  log_info "NFS server:        ${NFS_SERVER}  (path ${NFS_PATH})"
  log_info "App namespace:     ${APP_NAMESPACE}"
  log_info "Bench namespace:   ${BENCH_NAMESPACE}"

  log_info "Preflight complete"
  return 0
}

# ---------------------------------------------------------------------------
# stage_provision (only when --provision AND cluster NOT already healthy)
# Renders a kubespray inventory from node IPs and runs the vendored cluster.yml.
# This is the ONLY stage needing SSH/sudo. Guarded heavily.
# ---------------------------------------------------------------------------
stage_provision() {
  _stage_banner provision "kubespray bare-node bring-up (guarded)"

  if [[ "${OPT_PROVISION:-false}" != "true" ]]; then
    log_info "Provisioning not requested (--provision absent) — skipping"
    return 0
  fi

  # Skip if the cluster is already healthy (caller supplied a KUBECONFIG that
  # already points at an up cluster) — existing behavior.
  if stages_cluster_online && kubectl get nodes &>/dev/null; then
    local ready_nodes
    ready_nodes=$(kubectl get nodes --no-headers 2>/dev/null | awk '$2 ~ /Ready/' | wc -l | tr -d ' ')
    if [[ "${ready_nodes:-0}" -gt 0 ]]; then
      log_info "Cluster already healthy (${ready_nodes} Ready node(s)) — skipping kubespray provisioning"
      return 0
    fi
  fi

  # Prefer the spec path .../app/kubespray (sibling of .../app/kubernetes), then
  # fall back to the stripped-parent and platform-nested variants.
  local kubespray_dir="${PLATFORM_DIR%/kubernetes}/kubespray"
  if [[ ! -d "$kubespray_dir" ]]; then
    kubespray_dir="${PLATFORM_DIR%/app/kubernetes}/kubespray"
  fi
  if [[ ! -d "$kubespray_dir" ]]; then
    kubespray_dir="${PLATFORM_DIR}/kubespray"
  fi

  # Dedicated render-dir inventory (NEVER inventory/etri). YAML hosts.yml mirrors
  # /home/kcloud/etri-llm-deployments/app/kubespray/inventory/etri/hosts.yml:
  # ansible_user=kcloud + ansible_password/ansible_become_password reading the
  # env var via lookup('env','SUDO_PASS'). The password is never written as a
  # literal — only the Jinja lookup expression is emitted.
  local inv_dir="${RENDER_DIR}/inventory"
  mkdir -p "$inv_dir"
  local inv_out="${inv_dir}/hosts.yml"
  _generate_kubespray_hosts_yaml > "$inv_out"
  chmod 600 "$inv_out" 2>/dev/null || true
  log_info "Generated kubespray inventory (YAML, credentials via env lookup) → ${inv_out}"

  # Copy group_vars/ from the vendored kubespray inventory so CNI (calico) + k8s
  # settings are present alongside the rendered hosts.yml.
  if ! _copy_kubespray_group_vars "$kubespray_dir" "$inv_dir"; then
    log_warn "Could not copy kubespray group_vars — cluster.yml may fall back to defaults."
  fi

  # HARD ASSERTION: the rendered inventory must contain EXACTLY the supplied IPs
  # and NONE of the forbidden old-cluster IPs. Abort if violated.
  if ! _assert_inventory_ips "$inv_out"; then
    return 1
  fi

  if stages_dryrun_active; then
    log_info "[dry-run] would run kubespray cluster.yml with inventory ${inv_out} (SSH port ${SSH_PORT_PROVISION:-${SSH_PORT_CP}}); no SSH performed"
    log_info "[dry-run] would export SUDO_PASS into the ansible-playbook environment (value never logged)"
    log_info "[dry-run] would fetch ${CONTROL_PLANE_IP}:/etc/kubernetes/admin.conf and rewrite server → https://${CONTROL_PLANE_IP}:6443"
    return 0
  fi

  if [[ ! -d "$kubespray_dir" ]]; then
    log_error "Kubespray directory not found (looked in ${kubespray_dir}). Cannot provision."
    log_error "Provide a vendored kubespray under the platform tree, or omit --provision on an existing cluster."
    return 1
  fi

  # SUDO_PASS must be present (orchestrator validate_args fails fast otherwise,
  # but re-check here for the --only provision entry path).
  if [[ -z "${SUDO_PASS:-}" ]]; then
    log_error "SUDO_PASS is not set — cannot run kubespray unattended (sudo/become would prompt)."
    log_error "Set SUDO_PASS (or SSHPASS) in the environment and re-run."
    return 1
  fi

  log_warn "Provisioning bare nodes via kubespray — SSH port ${SSH_PORT_PROVISION:-${SSH_PORT_CP}}, user kcloud, sudo via SUDO_PASS (value never logged)."
  log_info "Running: ansible-playbook -i ${inv_out} -b cluster.yml  (cwd ${kubespray_dir})"
  # Export SUDO_PASS into the playbook environment so the inventory's
  # lookup('env','SUDO_PASS') resolves. Never echoed.
  if ! (
    cd "$kubespray_dir" || exit 1
    SUDO_PASS="${SUDO_PASS}" ANSIBLE_HOST_KEY_CHECKING=False \
      ansible-playbook -i "$inv_out" -b cluster.yml
  ); then
    log_error "kubespray cluster.yml failed — see ansible output above."
    return 1
  fi
  log_info "Provisioning complete"

  # KUBECONFIG hand-off: fetch the new control-plane admin.conf, rewrite the
  # server to the control-plane IP, persist 0600, and export so ALL later stages
  # target the NEW cluster.
  if ! _provision_handoff_kubeconfig; then
    log_error "Provisioned the cluster but failed to fetch/install the new KUBECONFIG."
    return 1
  fi
  return 0
}

# _generate_kubespray_hosts_yaml — emit a kubespray YAML inventory from NODE_IPS.
# ip1 = kube_control_plane + etcd; remaining IPs = kube_node. Every host carries
# ansible_user=kcloud and ansible_password / ansible_become_password sourced from
# the SUDO_PASS env var via a Jinja lookup (NEVER a literal password). ansible_port
# = SSH_PORT_PROVISION (the operator-supplied --ssh-port) for ALL nodes.
_generate_kubespray_hosts_yaml() {
  local -a ips=()
  local raw
  IFS=',' read -ra raw <<< "$NODE_IPS"
  local ip
  for ip in "${raw[@]}"; do
    ip="${ip// /}"
    [[ -n "$ip" ]] && ips+=("$ip")
  done
  local n=${#ips[@]}
  local port="${SSH_PORT_PROVISION:-${SSH_PORT_CP}}"
  local i name

  printf '# Generated by kcloud-tool stage_provision from --node-ips (DO NOT EDIT).\n'
  printf '# First IP = kube_control_plane + etcd; remaining = kube_node.\n'
  printf '# Credentials read from the SUDO_PASS env var via lookup; never a literal.\n'
  printf 'all:\n'
  printf '  hosts:\n'
  for ((i = 1; i <= n; i++)); do
    name="node${i}"
    printf '    %s:\n' "$name"
    printf '      ansible_host: %s\n' "${ips[i-1]}"
    printf '      ansible_port: %s\n' "$port"
    printf '      ip: %s\n' "${ips[i-1]}"
    printf '      ansible_user: kcloud\n'
    printf "      ansible_password: \"{{ lookup('env', 'SUDO_PASS') }}\"\n"
    printf "      ansible_become_password: \"{{ lookup('env', 'SUDO_PASS') }}\"\n"
    [[ "$i" -eq 1 ]] && printf '      etcd_member_name: etcd1\n'
  done
  printf '  children:\n'
  printf '    kube_control_plane:\n      hosts:\n        node1:\n'
  printf '    kube_node:\n      hosts:\n'
  if [[ "$n" -le 1 ]]; then
    printf '        node1:\n'
  else
    for ((i = 2; i <= n; i++)); do printf '        node%d:\n' "$i"; done
  fi
  printf '    etcd:\n      hosts:\n        node1:\n'
  printf '    k8s_cluster:\n      children:\n        kube_control_plane:\n        kube_node:\n'
  printf '    calico_rr:\n      hosts: {}\n'
}

# _copy_kubespray_group_vars <kubespray_dir> <dest_inv_dir> — copy group_vars/
# from the vendored inventory (prefer inventory/etri, fall back to
# inventory/sample) so the CNI (calico) + k8s settings ship with the rendered
# hosts.yml. Returns 1 if no source group_vars dir is found.
_copy_kubespray_group_vars() {
  local kubespray_dir="$1" dest="$2"
  local src=""
  if [[ -d "${kubespray_dir}/inventory/etri/group_vars" ]]; then
    src="${kubespray_dir}/inventory/etri/group_vars"
  elif [[ -d "${kubespray_dir}/inventory/sample/group_vars" ]]; then
    src="${kubespray_dir}/inventory/sample/group_vars"
  else
    return 1
  fi
  rm -rf "${dest}/group_vars"
  cp -a "${src}" "${dest}/group_vars"
  log_info "Copied kubespray group_vars from ${src} → ${dest}/group_vars (CNI + k8s settings)"
  return 0
}

# _assert_inventory_ips <hosts.yml> — HARD GATE. Confirm the rendered inventory's
# ansible_host entries are EXACTLY the supplied --node-ips (same set, no more, no
# fewer) and contain NONE of the forbidden old-cluster IPs. Abort (return 1) on
# any violation.
_assert_inventory_ips() {
  local f="$1"
  if [[ ! -f "$f" ]]; then
    log_error "Inventory not found for assertion: ${f}"
    return 1
  fi

  # 1. No forbidden old-cluster IP may appear (and none of them is legitimately
  #    supplied for the new cluster).
  local leaked
  if leaked="$(_stages_scan_forbidden_ips "$f")"; then
    : # clean
  else
    log_error "Rendered kubespray inventory contains forbidden old-cluster IP '${leaked}'. Aborting provision to avoid targeting the departing cluster."
    return 1
  fi

  # 2. The set of ansible_host IPs must equal the set of supplied --node-ips.
  local -a want=()
  local raw ip
  IFS=',' read -ra raw <<< "$NODE_IPS"
  for ip in "${raw[@]}"; do
    ip="${ip// /}"
    [[ -n "$ip" ]] && want+=("$ip")
  done

  local -a got=()
  while IFS= read -r ip; do
    [[ -n "$ip" ]] && got+=("$ip")
  done < <(grep -oE 'ansible_host:[[:space:]]*[0-9.]+' "$f" 2>/dev/null | awk '{print $2}')

  # Compare as sorted unique sets.
  local want_sorted got_sorted
  want_sorted="$(printf '%s\n' "${want[@]}" | sort -u)"
  got_sorted="$(printf '%s\n' "${got[@]}" | sort -u)"
  if [[ "$want_sorted" != "$got_sorted" ]]; then
    log_error "Inventory IP set does not match --node-ips."
    log_error "  expected: $(printf '%s ' "${want[@]}")"
    log_error "  rendered: $(printf '%s ' "${got[@]}")"
    return 1
  fi

  # 3. The control-plane (node1) must be the FIRST supplied IP.
  local cp_ip
  cp_ip="$(awk '/^    node1:/{f=1} f&&/ansible_host:/{print $2; exit}' "$f" 2>/dev/null)"
  if [[ -n "${want[0]:-}" && "$cp_ip" != "${want[0]}" ]]; then
    log_error "Control-plane (node1) IP '${cp_ip}' is not the first --node-ips entry '${want[0]}'."
    return 1
  fi

  log_info "Inventory IP assertion passed: ${#got[@]} node(s), control-plane=${cp_ip}, no forbidden IP."
  return 0
}

# _provision_handoff_kubeconfig — after a successful provision, fetch the new
# control-plane's /etc/kubernetes/admin.conf from the FIRST node, rewrite its
# server to https://<CONTROL_PLANE_IP>:6443, save 0600 to RENDER_DIR, and export
# KUBECONFIG so every later stage targets the NEW cluster. Uses sshpass with the
# SUDO_PASS password (never logged).
_provision_handoff_kubeconfig() {
  local kubeconfig_out="${RENDER_DIR}/admin.conf"
  local port="${SSH_PORT_PROVISION:-${SSH_PORT_CP}}"
  local host="${CONTROL_PLANE_IP}"

  if [[ -z "${SUDO_PASS:-}" ]]; then
    log_error "Cannot fetch new KUBECONFIG: SUDO_PASS unset."
    return 1
  fi
  if ! command -v sshpass >/dev/null 2>&1; then
    log_error "sshpass not found — required to fetch admin.conf from ${host} unattended."
    return 1
  fi

  log_info "Fetching new KUBECONFIG from ${host}:/etc/kubernetes/admin.conf (password-auth; never logged)."
  # Read the remote admin.conf via sudo (-S reads the sudo password on stdin).
  if ! SSHPASS="${SUDO_PASS}" sshpass -e ssh \
      -p "${port}" \
      -o StrictHostKeyChecking=no \
      -o UserKnownHostsFile=/dev/null \
      -o PreferredAuthentications=password \
      -o PubkeyAuthentication=no \
      "kcloud@${host}" \
      "echo '${SUDO_PASS}' | sudo -S cat /etc/kubernetes/admin.conf" \
      > "${kubeconfig_out}" 2>/dev/null; then
    log_error "Failed to fetch admin.conf from ${host} (SSH/sudo). Cannot hand off KUBECONFIG."
    rm -f "${kubeconfig_out}"
    return 1
  fi
  chmod 600 "${kubeconfig_out}" 2>/dev/null || true

  if [[ ! -s "${kubeconfig_out}" ]]; then
    log_error "Fetched admin.conf is empty — KUBECONFIG hand-off failed."
    rm -f "${kubeconfig_out}"
    return 1
  fi

  # Rewrite the server endpoint to the control-plane's reachable IP.
  sed -i -E "s#server:[[:space:]]*https://[^[:space:]]+#server: https://${host}:6443#" "${kubeconfig_out}"

  export KUBECONFIG="${kubeconfig_out}"
  CLUSTER_OFFLINE=false
  export CLUSTER_OFFLINE
  log_info "KUBECONFIG handed off → ${kubeconfig_out} (server https://${host}:6443); later stages target the NEW cluster."
  return 0
}

# ---------------------------------------------------------------------------
# stage_storage
# Render nfs override (server=NFS_SERVER, path=NFS_PATH) → helm upgrade --install
# the vendored nfs-subdir provisioner. Verify a default RWX StorageClass exists.
# CPU/kind fallback: accept an existing default SC and warn that RWX degrades.
# ---------------------------------------------------------------------------
stage_storage() {
  _stage_banner storage "NFS RWX provisioner (vendored nfs-subdir chart)"

  local nfs_chart
  nfs_chart=$(_find_chart "nfs-subdir-external-provisioner")
  if [[ -z "$nfs_chart" ]]; then
    log_error "NFS provisioner chart not found under ${PLATFORM_DIR}"
    return 1
  fi

  # Render the override from the FROZEN template, else generate a minimal one.
  local override="${RENDER_DIR}/nfs-values-override.yaml"
  local tmpl="${DEPLOY_PLATFORM_DIR}/nfs-values-override.yaml.tmpl"
  if [[ -f "$tmpl" ]]; then
    _render_tmpl "$tmpl" "$override"
    log_info "Rendered NFS override (from template) → ${override}"
  else
    log_warn "NFS override template not found: ${tmpl} — generating from FROZEN vars"
    {
      printf '# generated by kcloud-tool stage_storage (no template found)\n'
      printf 'nfs:\n  server: %s\n  path: %s\n' "$NFS_SERVER" "$NFS_PATH"
      printf 'storageClass:\n  name: nfs-client\n  defaultClass: true\n  accessModes: ReadWriteMany\n'
      printf 'replicaCount: 1\n'
    } > "$override"
    log_info "Generated NFS override → ${override}"
  fi

  # Guard: never let a FORBIDDEN old-cluster IP leak into the rendered override.
  # Supplied --node-ips / --nfs-server / --access-ip (incl. node4=10.254.202.114,
  # node5=10.254.202.111) are LEGITIMATE and never rejected — only an old IP that
  # is NEITHER supplied NOR expected aborts.
  local _leaked_nfs
  if _leaked_nfs="$(_stages_scan_forbidden_ips "$override")"; then
    : # clean
  else
    log_error "Rendered NFS override contains forbidden old-cluster IP '${_leaked_nfs}' (not among --node-ips/--nfs-server=${NFS_SERVER}). Aborting to avoid leaking upstream config."
    return 1
  fi

  if ! _helm_install "nfs-subdir-external-provisioner" "$nfs_chart" "nfs-provisioner" -f "$override"; then
    log_error "NFS provisioner install failed"
    return 1
  fi

  # Verify (or fallback): a usable default StorageClass exists.
  if stages_dryrun_active || ! stages_cluster_online; then
    log_info "[dry-run] would verify a default RWX StorageClass exists after install"
    return 0
  fi

  local sc
  sc=$(detect_storage_class)
  if [[ -n "$sc" ]]; then
    local access
    access=$(detect_pvc_access_mode "$sc")
    log_info "StorageClass available: ${sc} (access mode ${access})"
    if [[ "$access" != "ReadWriteMany" ]]; then
      log_warn "Default StorageClass '${sc}' is not RWX — RWX-only features (shared results PVC) will degrade."
    fi
    return 0
  fi

  log_error "No usable StorageClass after NFS install. Check NFS server ${NFS_SERVER}:${NFS_PATH} reachability/exports."
  return 1
}

# ---------------------------------------------------------------------------
# stage_operators
# Per detected/--device mode: GPU operator / furiosa (best-effort). Skip cleanly
# when hardware absent (kind/CPU). Verify device plugin + allocatable resource.
# ---------------------------------------------------------------------------
stage_operators() {
  _stage_banner operators "device operators per mode '${DEVICE_MODE}'"

  if [[ "${OPT_SKIP_OPERATORS:-false}" == "true" ]]; then
    log_warn "Operators stage skipped (--skip-operators)"
    return 0
  fi

  case "${DEVICE_MODE}" in
    cpu)
      log_info "Device mode 'cpu' — no device operator required. Skipping."
      return 0
      ;;
    gpu)
      local gpu_chart
      gpu_chart=$(_find_chart "gpu-operator")
      if [[ -z "$gpu_chart" ]]; then
        log_warn "GPU operator chart not found under ${PLATFORM_DIR} — skipping (warn)."
        return 0
      fi
      log_info "Installing vendored NVIDIA gpu-operator (A30) from ${gpu_chart}."
      # Worker GPU nodes (jw2/jw3) already have a host-installed NVIDIA driver, so tell the
      # operator to USE it (driver.enabled=false) instead of deploying its own driver DaemonSet,
      # which would try to build/load a conflicting kernel module and hang/abort the stage.
      # The vendored chart is a dev snapshot (Chart appVersion="main-latest", which is NOT a real
      # nvcr.io tag -> ImagePullBackOff). Pin the operator image to the chart's real release line.
      # Both the operator AND validator images default to the chart appVersion (main-latest, invalid),
      # so pin both to the real release tag. Other components carry explicit valid versions.
      if ! _helm_install "gpu-operator" "$gpu_chart" "gpu-operator" \
            --set driver.enabled=false \
            --set operator.version=v25.10.0 \
            --set validator.version=v25.10.0; then
        # The gpu-operator pulls driver/toolkit/device-plugin images from public
        # registries (nvcr.io / registry.k8s.io). On an air-gapped or
        # egress-restricted cluster these pulls fail and the operator never goes
        # Ready. Flag this as the most likely real cause with an actionable hint
        # rather than hanging.
        log_error "GPU operator install failed (helm wait timed out or pods did not become Ready)."
        log_error "MOST LIKELY CAUSE: no registry/internet egress on the new cluster — the gpu-operator must pull images from nvcr.io / registry.k8s.io."
        log_error "ACTION: confirm the nodes can reach those registries (or configure a mirror / pre-pulled images), then re-run '--only operators'."
        if [[ "${OPT_FORCE:-false}" == "true" ]]; then
          log_warn "Continuing despite GPU operator failure (--force)."
          return 0
        fi
        return 1
      fi
      _verify_device_resource "nvidia.com/gpu"
      ;;
    npu-rngd)
      _install_furiosa_operator
      _verify_device_resource "furiosa.ai/rngd"
      ;;
    npu-atom)
      log_warn "Rebellions Atom+ operator install is not driven by this installer (parked upstream)."
      log_warn "Detecting existing rbln device plugin instead."
      _verify_device_resource "rebellions.ai/ATOM"
      ;;
    *)
      log_warn "Unknown device mode '${DEVICE_MODE}' — skipping operators."
      ;;
  esac
  return 0
}

# _install_furiosa_operator — drive the upstream 08-deploy script in a COPY, or
# fall back to a best-effort helm repo install. Needs egress; skip cleanly on fail.
_install_furiosa_operator() {
  if stages_dryrun_active; then
    log_info "[dry-run] would install FuriosaAI device plugin (helm repo furiosa; needs egress) — best-effort"
    return 0
  fi
  if ! stages_cluster_online; then
    log_info "[offline] skipping furiosa operator install"
    return 0
  fi
  log_warn "Installing FuriosaAI device plugin (best-effort; requires egress to the furiosa helm repo)."
  # Missing helm-repo egress must NOT abort the full-stack run — downgrade to warn.
  if ! helm repo add furiosa https://furiosa-ai.github.io/helm-charts >/dev/null 2>&1; then
    log_warn "Could not add furiosa helm repo (egress?). Skipping furiosa install best-effort."
    return 0
  fi
  helm repo update furiosa >/dev/null 2>&1 || log_warn "furiosa helm repo update failed (continuing)."
  _ensure_namespace "furiosa-system"
  if ! helm upgrade --install furiosa-device-plugin furiosa/furiosa-device-plugin \
      --namespace furiosa-system \
      --timeout "${TIMEOUT:-600}s" >/dev/null 2>&1; then
    log_warn "Furiosa device-plugin install failed (egress/repo?). Continuing best-effort."
    return 0
  fi
  helm upgrade --install furiosa-feature-discovery furiosa/furiosa-feature-discovery \
    --namespace furiosa-system \
    --timeout "${TIMEOUT:-600}s" >/dev/null 2>&1 || \
    log_warn "Furiosa feature-discovery install failed. Continuing best-effort."
  log_info "FuriosaAI device plugin install attempted."
  return 0
}

# _verify_device_resource <resource-key> — warn (not fail) when absent.
_verify_device_resource() {
  local res="$1"
  if stages_dryrun_active || ! stages_cluster_online; then
    log_info "[dry-run] would verify allocatable device resource '${res}' appears on a node"
    return 0
  fi
  # escape dots for jsonpath-free grep on JSON
  local res_re="${res//./\\.}"
  if kubectl get nodes -o json 2>/dev/null | grep -q "\"${res_re}\""; then
    log_info "Allocatable device resource present: ${res}"
  else
    log_warn "Device resource '${res}' not yet allocatable — operator may still be initializing (this is a warn, not a failure)."
  fi
}

# ---------------------------------------------------------------------------
# stage_observability (unless skipped)
# loki, kube-prometheus-stack, alloy via vendored charts. Verify releases deployed.
# ---------------------------------------------------------------------------
stage_observability() {
  _stage_banner observability "loki + kube-prometheus-stack + alloy"

  if [[ "${OPT_SKIP_OBSERVABILITY:-false}" == "true" ]]; then
    log_warn "Observability stage skipped (--skip-observability)"
    return 0
  fi

  local rc=0

  local loki_chart prom_chart alloy_chart
  loki_chart=$(_find_chart "loki")
  prom_chart=$(_find_chart "kube-prometheus-stack")
  alloy_chart=$(_find_chart "alloy")

  if [[ -n "$loki_chart" ]]; then
    _helm_install "loki" "$loki_chart" "loki" || { log_warn "loki install failed"; rc=1; }
  else
    log_warn "loki chart not found — skipping"
  fi

  if [[ -n "$prom_chart" ]]; then
    _helm_install "kube-prometheus-stack" "$prom_chart" "monitoring" || { log_warn "kube-prometheus-stack install failed"; rc=1; }
  else
    log_warn "kube-prometheus-stack chart not found — skipping"
  fi

  if [[ -n "$alloy_chart" ]]; then
    _helm_install "alloy" "$alloy_chart" "monitoring" || { log_warn "alloy install failed"; rc=1; }
  else
    log_warn "alloy chart not found — skipping"
  fi

  if stages_dryrun_active || ! stages_cluster_online; then
    log_info "[dry-run] would verify observability releases are deployed"
    return 0
  fi

  # Verify each release reports a deployed status (warn-only stage overall).
  local rel
  for rel in loki kube-prometheus-stack alloy; do
    local rel_namespace
    case "$rel" in
      loki) rel_namespace="loki" ;;
      *)    rel_namespace="monitoring" ;;
    esac
    local status
    status=$(helm status "$rel" -n "$rel_namespace" -o json 2>/dev/null | jq -r '.info.status' 2>/dev/null || echo "")
    if [[ "$status" == "deployed" ]]; then
      log_info "Release '${rel}' status: deployed"
    else
      log_warn "Release '${rel}' status: ${status:-unknown}"
    fi
  done

  [[ "$rc" -eq 0 ]] && log_info "Observability stage complete" || log_warn "Observability stage completed with warnings"
  return 0
}

# ---------------------------------------------------------------------------
# stage_webapp (unless skipped)
# Render app-chart values override + regenerated config/cluster.yaml + frontend
# secret (VITE URL = http://ACCESS_IP:BACKEND_NODEPORT/api) into a COPY of the
# chart under RENDER_DIR, then helm upgrade --install. Verify rollouts + reachability.
# ---------------------------------------------------------------------------
stage_webapp() {
  _stage_banner webapp "ETRI LLM app-chart (frontend + backend + database)"

  if [[ "${OPT_SKIP_WEBAPP:-false}" == "true" ]]; then
    log_warn "Webapp stage skipped (--skip-webapp)"
    return 0
  fi

  local src_chart="${PLATFORM_DIR}/app-chart"
  if [[ ! -d "$src_chart" ]]; then
    log_error "app-chart not found at ${src_chart}"
    return 1
  fi

  # Work on a COPY — never edit upstream.
  local work_chart="${RENDER_DIR}/app-chart"
  rm -rf "$work_chart"
  mkdir -p "$work_chart"
  cp -a "${src_chart}/." "$work_chart/"
  log_info "Copied app-chart → ${work_chart} (upstream untouched)"

  # 1. values override
  local override="${RENDER_DIR}/app-chart-values-override.yaml"
  local val_tmpl="${DEPLOY_PLATFORM_DIR}/app-chart-values-override.yaml.tmpl"
  if [[ -f "$val_tmpl" ]]; then
    _render_tmpl "$val_tmpl" "$override"
    log_info "Rendered app-chart values override (from template) → ${override}"
  else
    log_warn "app-chart values override template not found: ${val_tmpl} — generating from FROZEN vars"
    {
      printf '# generated by kcloud-tool stage_webapp (no template found)\n'
      printf 'namespace: %s\n' "$APP_NAMESPACE"
      printf 'frontend:\n  nodePort: %s\n' "$FRONTEND_NODEPORT"
      printf 'backend:\n  nodePort: %s\n' "$BACKEND_NODEPORT"
    } > "$override"
    log_info "Generated app-chart values override → ${override}"
  fi

  # 2. Patch the frontend secret IN PLACE with the correct browser-facing VITE URL,
  #    preserving every other key (incl. a Helm-templated HF_TOKEN).
  #    The upstream template hardcodes a dev-cluster IP; patch the COPY only.
  local fe_secret="${work_chart}/templates/etri-llm-frontend/secret.yaml"
  if [[ -f "$fe_secret" ]]; then
    _patch_frontend_secret "$fe_secret"
    log_info "Patched frontend secret VITE base URL -> http://${ACCESS_IP}:${BACKEND_NODEPORT}/api (HF_TOKEN preserved)"
  else
    # On a REAL install, shipping the chart with the dev IP silently breaks the UI.
    if ! stages_dryrun_active && stages_cluster_online; then
      log_error "Frontend secret template missing in chart copy (${fe_secret}); cannot set the browser->backend URL. Aborting."
      return 1
    fi
    log_warn "Frontend secret template not present in chart copy — skipping VITE override (dry-run/offline)"
  fi

  # 3. Regenerate the app device-SSH map from node IPs. Assemble WORKER_ENTRIES
  #    first so the template substitutes fully (no literal ${WORKER_ENTRIES}).
  local cluster_yaml="${work_chart}/config/cluster.yaml"
  local cl_tmpl="${DEPLOY_PLATFORM_DIR}/cluster.yaml.tmpl"
  _build_worker_entries
  if [[ -f "$cl_tmpl" ]]; then
    mkdir -p "$(dirname "$cluster_yaml")"
    _render_tmpl "$cl_tmpl" "$cluster_yaml"
    if ! _assert_no_unsubstituted "$cluster_yaml"; then
      log_error "Rendered cluster.yaml has unsubstituted placeholders — refusing to ship a malformed device registry."
      return 1
    fi
    log_info "Rendered config/cluster.yaml (from template) -> ${cluster_yaml}"
  else
    log_warn "cluster.yaml template not found: ${cl_tmpl} — regenerating from node IPs"
    mkdir -p "$(dirname "$cluster_yaml")"
    _generate_cluster_yaml > "$cluster_yaml"
    log_info "Regenerated config/cluster.yaml from node IPs -> ${cluster_yaml}"
  fi

  # Leak guard: no FORBIDDEN old-cluster IP should remain in the rendered VITE
  # secret. Supplied --access-ip / --node-ips (incl. node4=10.254.202.114,
  # node5=10.254.202.111) are LEGITIMATE; only an old IP that is NEITHER supplied
  # NOR expected aborts the install.
  if [[ -f "$fe_secret" ]]; then
    local _leaked_fe
    if _leaked_fe="$(_stages_scan_forbidden_ips "$fe_secret")"; then
      : # clean
    else
      log_error "Frontend secret still references forbidden old-cluster IP '${_leaked_fe}' (access-ip is ${ACCESS_IP}). Aborting."
      return 1
    fi
  fi

  # 4. helm upgrade --install against the working COPY.
  #    The app-chart derives object namespaces from .Values.global.namespace (NOT
  #    the release namespace), so force it to APP_NAMESPACE via --set-string as a
  #    belt-and-suspenders alongside the override file.
  local base_values="${work_chart}/values.yaml"
  local -a helm_args=()
  [[ -f "$base_values" ]] && helm_args+=( -f "$base_values" )
  helm_args+=( -f "$override" )
  helm_args+=( --set-string "global.namespace=${APP_NAMESPACE}" )

  if ! _helm_install "etri-llm-app" "$work_chart" "$APP_NAMESPACE" "${helm_args[@]}"; then
    log_error "Webapp (app-chart) install failed"
    return 1
  fi

  # 5. Verify rollouts + reachability.
  if stages_dryrun_active || ! stages_cluster_online; then
    log_info "[dry-run] would verify backend+frontend rollouts and NodePort reachability"
    return 0
  fi

  local rc=0
  _wait_rollout "deployment/etri-llm-backend" "$APP_NAMESPACE"  || rc=1
  _wait_rollout "deployment/etri-llm-frontend" "$APP_NAMESPACE" || rc=1

  local fe_url="http://${ACCESS_IP}:${FRONTEND_NODEPORT}"
  local be_url="http://${ACCESS_IP}:${BACKEND_NODEPORT}/api/devices"
  local fe_code be_code
  fe_code=$(_http_status "$fe_url")
  be_code=$(_http_status "$be_url")
  log_info "Frontend ${fe_url} → HTTP ${fe_code}"
  log_info "Backend  ${be_url} → HTTP ${be_code}"

  if [[ "$fe_code" =~ ^(2|3)[0-9][0-9]$ ]]; then
    log_info "Frontend reachable"
  else
    log_warn "Frontend not reachable yet (HTTP ${fe_code}) — service may still be warming up."
    rc=1
  fi
  if [[ "$be_code" =~ ^2[0-9][0-9]$ ]]; then
    log_info "Backend API reachable"
  else
    log_warn "Backend API not reachable yet (HTTP ${be_code})."
    rc=1
  fi

  [[ "$rc" -eq 0 ]] && log_info "Webapp stage complete" || log_warn "Webapp installed but reachability checks pending (re-run stage_verify after warm-up)."
  return 0
}

# _patch_frontend_secret <secret-file> — patch the chart-copy frontend Secret
# IN PLACE so it points at the resolved ACCESS_IP:BACKEND_NODEPORT, WITHOUT
# dropping any other key the upstream template carried.
#
# Strategy (no clobber):
#   1. Replace ONLY the VITE__APP_API_BASE_URL value line (preserves namespace,
#      labels, the {{ }} templating, and any other stringData key such as a
#      Helm-templated HF_TOKEN).
#   2. Guarantee an HF_TOKEN key is present: if the upstream template did not carry
#      one, append a Helm-templated HF_TOKEN line under stringData so the app keeps
#      its HuggingFace token. The token is ALWAYS a Helm template expression
#      ({{ .Values... }}), never a literal — nothing secret is written or logged.
#
# Never logs the token value.
_patch_frontend_secret() {
  local f="$1"
  local new_url="http://${ACCESS_IP}:${BACKEND_NODEPORT}/api"

  if [[ ! -f "$f" ]]; then
    log_warn "Frontend secret file not present (${f}) — skipping VITE patch"
    return 0
  fi

  # 1. Replace the VITE value in place (quoted or unquoted, with or without
  #    leading scheme). Match the key and rewrite the whole value to the new URL.
  #    Use a non-/ delimiter since the value contains slashes.
  local tmp
  tmp="$(mktemp "${RENDER_DIR}/.fe-secret.XXXXXX")"
  chmod 600 "$tmp" 2>/dev/null || true
  sed -E "s#^([[:space:]]*VITE__APP_API_BASE_URL:[[:space:]]*).*#\1\"${new_url}\"#" "$f" > "$tmp"
  mv "$tmp" "$f"

  # 2. Ensure a Helm-templated HF_TOKEN key exists under stringData. We only add
  #    it if NO HF_TOKEN key is already present (preserve the upstream one as-is).
  if ! grep -qE '^[[:space:]]*HF_TOKEN:' "$f"; then
    # Find the indentation used by VITE__APP_API_BASE_URL to align the new key.
    local indent
    indent="$(grep -m1 -E '^[[:space:]]*VITE__APP_API_BASE_URL:' "$f" | sed -E 's#^([[:space:]]*).*#\1#')"
    [[ -z "$indent" ]] && indent="  "

    # Determine the correct template ROOT. The upstream secret wraps its body in
    # '{{- with .Values }}', which rebinds '.' to .Values inside the block, so the
    # root is '.' there but '$.Values' otherwise.
    local hf_root='$.Values'
    if grep -qE '^\{\{-?[[:space:]]*with[[:space:]]+\.Values[[:space:]]*-?\}\}' "$f"; then
      hf_root='.'
    fi
    # Safe traversal that never nil-pointers when the components/etriLLMFrontend/
    # secret/hfToken chain is ABSENT (upstream values may have no secret key).
    # Each step uses `index` (returns nil for a missing key, no error) and the
    # final value is `default ""`-guarded, then quoted. Emitted on ONE line so the
    # surrounding YAML/awk insertion stays valid. The value is ALWAYS a Helm
    # expression (never a literal token); nothing secret is written or logged.
    local hf_expr="{{ index (index (index (index ${hf_root} \"components\" | default dict) \"etriLLMFrontend\" | default dict) \"secret\" | default dict) \"hfToken\" | default \"\" | quote }}"

    local tmp2
    tmp2="$(mktemp "${RENDER_DIR}/.fe-secret.XXXXXX")"
    chmod 600 "$tmp2" 2>/dev/null || true
    # Insert the HF_TOKEN line immediately after the VITE line.
    awk -v ind="$indent" -v expr="$hf_expr" '
      { print }
      /^[[:space:]]*VITE__APP_API_BASE_URL:/ && !done {
        printf "%sHF_TOKEN: %s\n", ind, expr
        done=1
      }
    ' "$f" > "$tmp2"
    mv "$tmp2" "$f"
  fi

  chmod 600 "$f" 2>/dev/null || true
}

# _generate_cluster_yaml — rebuild the app device-SSH map from NODE_IPS.
# ip1 = control-plane (SSH_PORT_CP); remaining nodes = workers (SSH_PORT_CP,
# except NPU nodes use SSH_PORT_NPU — accelerator unknown at render time so we
# default workers to SSH_PORT_CP and note NPU override in docs).
_generate_cluster_yaml() {
  local -a ips
  IFS=',' read -ra ips <<< "$NODE_IPS"
  printf '# Regenerated by kcloud-tool from --node-ips\n'
  printf '# Maps node names to SSH connection details for benchmark execution\n'
  printf 'nodes:\n'
  local i=1
  local ip
  for ip in "${ips[@]}"; do
    ip="${ip// /}"
    if [[ "$i" -eq 1 ]]; then
      printf '  node%d:\n    host: %s\n    port: %s\n    role: control-plane\n' "$i" "$ip" "$SSH_PORT_CP"
    else
      printf '  node%d:\n    host: %s\n    port: %s\n    role: worker\n' "$i" "$ip" "$SSH_PORT_CP"
    fi
    i=$((i + 1))
  done
}

# ---------------------------------------------------------------------------
# stage_benchmarks (unless skipped)
# DELEGATE to scripts/install_pilot_k8s.sh — reuse, do not duplicate.
# ---------------------------------------------------------------------------
stage_benchmarks() {
  _stage_banner benchmarks "delegate to install_pilot_k8s.sh (benchmark layer)"

  if [[ "${OPT_SKIP_BENCHMARKS:-false}" == "true" ]]; then
    log_warn "Benchmarks stage skipped (--skip-benchmarks)"
    return 0
  fi

  local pilot="${SCRIPT_DIR}/install_pilot_k8s.sh"
  if [[ ! -x "$pilot" && ! -f "$pilot" ]]; then
    log_error "Pilot installer not found at ${pilot} — cannot run benchmark stage."
    return 1
  fi

  # Discover which flags the pilot actually supports so we never abort the full
  # run by passing an unsupported flag. Probe --help once (read-only).
  local pilot_help=""
  pilot_help="$(bash "$pilot" --help 2>&1 || true)"
  _pilot_supports() { printf '%s' "$pilot_help" | grep -qE -- "(^|[^[:alnum:]_])$1([^[:alnum:]_-]|$)"; }

  local -a pilot_args=( --node-ips "$NODE_IPS" )

  # Namespace flag: the pilot's benchmark namespace flag. Pass --namespace only
  # if it is supported (drop silently otherwise).
  if _pilot_supports '--namespace'; then
    pilot_args+=( --namespace "$BENCH_NAMESPACE" )
  else
    log_warn "Pilot installer does not advertise --namespace; using its default benchmark namespace."
  fi

  _pilot_supports '--timeout' && pilot_args+=( --timeout "${TIMEOUT:-600}" )

  if [[ "${DEVICE_ARG:-auto}" != "auto" ]] && _pilot_supports '--device'; then
    pilot_args+=( --device "$DEVICE_ARG" )
  fi

  if stages_dryrun_active && _pilot_supports '--dry-run'; then
    pilot_args+=( --dry-run )
  fi

  [[ "${OPT_FORCE:-false}" == "true" ]] && _pilot_supports '--force' && pilot_args+=( --force )

  log_info "Delegating to: install_pilot_k8s.sh ${pilot_args[*]}"
  if bash "$pilot" "${pilot_args[@]}"; then
    log_info "Benchmark stage complete"
    return 0
  fi
  if [[ "${OPT_FORCE:-false}" == "true" ]]; then
    log_warn "Benchmark stage reported failure — continuing (--force)."
    return 0
  fi
  log_error "Benchmark stage (install_pilot_k8s.sh) failed."
  return 1
}

# ---------------------------------------------------------------------------
# stage_verify
# Cluster-wide health report. REQUIRED checks = webapp + storage; others warn.
# Prints a final health table + ACCESS URLS. Non-zero if a required check fails.
# ---------------------------------------------------------------------------
stage_verify() {
  _stage_banner verify "cluster-wide health + web UI reachability"

  if stages_dryrun_active || ! stages_cluster_online; then
    log_info "[dry-run] would verify: nodes Ready, default StorageClass, device plugin (if HW), observability, web UI reachable"
    _print_access_urls
    return 0
  fi

  local req_fail=0
  declare -a rows=()

  # --- nodes Ready (required-ish; warn if cannot query) ---
  local total ready
  total=$(kubectl get nodes --no-headers 2>/dev/null | wc -l | tr -d ' ')
  ready=$(kubectl get nodes --no-headers 2>/dev/null | awk '$2 ~ /Ready/' | wc -l | tr -d ' ')
  if [[ "${total:-0}" -gt 0 && "${ready:-0}" -eq "${total:-0}" ]]; then
    rows+=("nodes|REQUIRED|OK|${ready}/${total} Ready")
  else
    rows+=("nodes|REQUIRED|FAIL|${ready:-0}/${total:-0} Ready")
    req_fail=1
  fi

  # --- storage (REQUIRED) ---
  local sc
  sc=$(detect_storage_class)
  if [[ -n "$sc" ]]; then
    local access
    access=$(detect_pvc_access_mode "$sc")
    rows+=("storage|REQUIRED|OK|default SC '${sc}' (${access})")
  else
    rows+=("storage|REQUIRED|FAIL|no usable StorageClass")
    req_fail=1
  fi

  # --- operators (warn if skipped/absent) ---
  if [[ "${OPT_SKIP_OPERATORS:-false}" == "true" ]]; then
    rows+=("operators|optional|SKIP|--skip-operators")
  elif [[ "${DEVICE_MODE}" == "cpu" ]]; then
    rows+=("operators|optional|SKIP|cpu mode (no device operator)")
  else
    local dres
    dres=$(detect_device_resource "$DEVICE_MODE")
    local dres_re="${dres//./\\.}"
    if [[ -n "$dres" ]] && kubectl get nodes -o json 2>/dev/null | grep -q "\"${dres_re}\""; then
      rows+=("operators|optional|OK|${dres} allocatable")
    else
      rows+=("operators|optional|WARN|${dres:-device} not allocatable yet")
    fi
  fi

  # --- observability (warn if skipped) ---
  if [[ "${OPT_SKIP_OBSERVABILITY:-false}" == "true" ]]; then
    rows+=("observability|optional|SKIP|--skip-observability")
  else
    local prom_status
    prom_status=$(helm status kube-prometheus-stack -n monitoring -o json 2>/dev/null | jq -r '.info.status' 2>/dev/null || echo "")
    if [[ "$prom_status" == "deployed" ]]; then
      rows+=("observability|optional|OK|prometheus deployed")
    else
      rows+=("observability|optional|WARN|prometheus status ${prom_status:-unknown}")
    fi
  fi

  # --- webapp (REQUIRED) ---
  if [[ "${OPT_SKIP_WEBAPP:-false}" == "true" ]]; then
    rows+=("webapp|optional|SKIP|--skip-webapp")
  else
    local fe_url be_url fe_code be_code
    fe_url="http://${ACCESS_IP}:${FRONTEND_NODEPORT}"
    be_url="http://${ACCESS_IP}:${BACKEND_NODEPORT}/api/devices"
    fe_code=$(_http_status "$fe_url")
    be_code=$(_http_status "$be_url")
    local fe_ok=false be_ok=false
    [[ "$fe_code" =~ ^(2|3)[0-9][0-9]$ ]] && fe_ok=true
    if [[ "$be_code" =~ ^2[0-9][0-9]$ ]]; then
      # Confirm it returns JSON.
      if curl -s --max-time 10 "$be_url" 2>/dev/null | jq -e . >/dev/null 2>&1; then
        be_ok=true
      fi
    fi
    if [[ "$fe_ok" == "true" && "$be_ok" == "true" ]]; then
      rows+=("webapp|REQUIRED|OK|frontend HTTP ${fe_code}, backend JSON ${be_code}")
    else
      rows+=("webapp|REQUIRED|FAIL|frontend HTTP ${fe_code}, backend HTTP ${be_code}")
      req_fail=1
    fi
  fi

  # --- benchmarks (warn if skipped) ---
  if [[ "${OPT_SKIP_BENCHMARKS:-false}" == "true" ]]; then
    rows+=("benchmarks|optional|SKIP|--skip-benchmarks")
  else
    if kubectl get namespace "$BENCH_NAMESPACE" &>/dev/null 2>&1; then
      rows+=("benchmarks|optional|OK|namespace ${BENCH_NAMESPACE} present")
    else
      rows+=("benchmarks|optional|WARN|namespace ${BENCH_NAMESPACE} absent")
    fi
  fi

  _print_health_table "${rows[@]}"
  _print_access_urls

  if [[ "$req_fail" -ne 0 ]]; then
    log_error "Verification FAILED — one or more REQUIRED checks did not pass (see table above)."
    return 1
  fi
  log_info "Verification PASSED — all REQUIRED checks OK."
  return 0
}

# _print_health_table <rows...>  rows are "name|class|status|detail"
_print_health_table() {
  log_step "===== HEALTH REPORT ====="
  printf '%b\n' "  CHECK            CLASS      STATUS  DETAIL" >&2
  printf '%b\n' "  ---------------  ---------  ------  ------------------------------------" >&2
  local row
  for row in "$@"; do
    local name class status detail
    IFS='|' read -r name class status detail <<< "$row"
    printf '  %-15s  %-9s  %-6s  %s\n' "$name" "$class" "$status" "$detail" >&2
  done
  log_step "========================="
}

# _print_access_urls — final ACCESS URLS block.
_print_access_urls() {
  log_step "===== ACCESS URLS ====="
  log_info "Web UI (frontend):   http://${ACCESS_IP}:${FRONTEND_NODEPORT}"
  log_info "Backend API:         http://${ACCESS_IP}:${BACKEND_NODEPORT}/api"
  log_info "Backend devices:     http://${ACCESS_IP}:${BACKEND_NODEPORT}/api/devices"
  log_step "======================="
}

# ---------------------------------------------------------------------------
# Shared rendering / discovery helpers
# ---------------------------------------------------------------------------

# _render_tmpl <src.tmpl> <dest> — envsubst only the FROZEN render variables.
# Rendered files may contain secret-adjacent material; tighten perms to 0600.
_render_tmpl() {
  local src="$1" dest="$2"
  mkdir -p "$(dirname "$dest")"
  envsubst "$STAGES_ENVSUBST_VARS" < "$src" > "$dest"
  chmod 600 "$dest" 2>/dev/null || true
}

# _find_chart <basename-prefix> — locate a vendored chart dir under PLATFORM_DIR
# whose name is exactly the prefix or prefix-<version> (avoids greedy sibling
# matches like loki-stack-* for prefix 'loki'). If several versioned dirs match,
# pick the highest version via sort -V. Logs the resolved dir.
_find_chart() {
  local prefix="$1"
  local -a candidates=()
  local d
  # Exact-name match first (e.g. PLATFORM_DIR/app-chart).
  if [[ -d "${PLATFORM_DIR}/${prefix}" && -f "${PLATFORM_DIR}/${prefix}/Chart.yaml" ]]; then
    candidates+=("${PLATFORM_DIR}/${prefix}")
  fi
  # Version-suffixed matches: prefix-<digit>... only (not prefix-<word>-...).
  for d in "${PLATFORM_DIR}/${prefix}"-[0-9]*; do
    [[ -d "$d" && -f "${d}/Chart.yaml" ]] && candidates+=("$d")
  done
  if [[ ${#candidates[@]} -eq 0 ]]; then
    printf ''
    return 1
  fi
  local chosen
  chosen=$(printf '%s\n' "${candidates[@]}" | sort -V | tail -n1)
  log_info "Resolved chart '${prefix}' -> ${chosen}"
  printf '%s' "$chosen"
  return 0
}

# _cluster_yaml_worker_entry <node-name> <ip> <port> — emit one YAML worker block
# (2-space indented to align under the "workers:" key). Accelerator unknown at
# render time, so default to cpu/intel; the operator may refine cluster.yaml.
_cluster_yaml_worker_entry() {
  local name="$1" ip="$2" port="$3"
  printf '  - name: %s\n    role: worker\n    accelerator: { type: cpu, vendor: intel, count: 0 }\n    ssh: { host: %s, port: %s }\n' \
    "$name" "$ip" "$port"
}

# _build_worker_entries — assemble WORKER_ENTRIES (YAML block for cluster.yaml.tmpl)
# from NODE_IPS. ip1 = control-plane (already emitted under control_plane:); the
# remaining IPs become workers. Empty when only one node. Strips empty/trailing
# tokens. Exports WORKER_ENTRIES.
_build_worker_entries() {
  local -a ips=()
  local raw
  IFS=',' read -ra raw <<< "$NODE_IPS"
  local ip
  for ip in "${raw[@]}"; do
    ip="${ip// /}"
    [[ -n "$ip" ]] && ips+=("$ip")
  done
  local entries=""
  local n=${#ips[@]}
  local i
  for ((i = 2; i <= n; i++)); do
    entries+="$(_cluster_yaml_worker_entry "node${i}" "${ips[i-1]}" "${SSH_PORT_CP}")"
    [[ "$i" -lt "$n" ]] && entries+=$'\n'
  done
  # Single-node cluster: no separate workers (the control-plane also schedules).
  WORKER_ENTRIES="$entries"
  export WORKER_ENTRIES
}

# _build_inventory_entries — assemble the kubespray inventory blocks from NODE_IPS.
# Exports NODE_ENTRIES_ALL, KUBE_CONTROL_PLANE_HOSTS, ETCD_HOSTS, KUBE_NODE_HOSTS.
_build_inventory_entries() {
  local -a ips=()
  local raw
  IFS=',' read -ra raw <<< "$NODE_IPS"
  local ip
  for ip in "${raw[@]}"; do
    ip="${ip// /}"
    [[ -n "$ip" ]] && ips+=("$ip")
  done
  local n=${#ips[@]}
  local all="" knodes=""
  local i name
  for ((i = 1; i <= n; i++)); do
    name="node${i}"
    if [[ "$i" -eq 1 ]]; then
      all+="${name} ansible_host=${ips[0]} ansible_port=${SSH_PORT_CP} ip=${ips[0]} etcd_member_name=etcd1"
    else
      all+="${name} ansible_host=${ips[i-1]} ansible_port=${SSH_PORT_CP} ip=${ips[i-1]}"
    fi
    [[ "$i" -lt "$n" ]] && all+=$'\n'
  done
  if [[ "$n" -le 1 ]]; then
    knodes="node1"
  else
    for ((i = 2; i <= n; i++)); do
      knodes+="node${i}"
      [[ "$i" -lt "$n" ]] && knodes+=$'\n'
    done
  fi
  NODE_ENTRIES_ALL="$all"
  KUBE_CONTROL_PLANE_HOSTS="node1"
  ETCD_HOSTS="node1"
  KUBE_NODE_HOSTS="$knodes"
  export NODE_ENTRIES_ALL KUBE_CONTROL_PLANE_HOSTS ETCD_HOSTS KUBE_NODE_HOSTS
}

# _assert_no_unsubstituted <file> — fail loudly if any literal ${...} survived a
# render (catches missing-whitelist / un-assembled-variable breakage).
_assert_no_unsubstituted() {
  local f="$1"
  if grep -qE '\$\{[A-Za-z_][A-Za-z0-9_]*\}' "$f" 2>/dev/null; then
    local leftover
    leftover=$(grep -oE '\$\{[A-Za-z_][A-Za-z0-9_]*\}' "$f" 2>/dev/null | sort -u | tr '\n' ' ')
    log_error "Rendered file ${f} still contains unsubstituted placeholder(s): ${leftover}"
    return 1
  fi
  return 0
}

# FROZEN render-variable whitelist for envsubst (only these are substituted).
# WORKER_ENTRIES / NODE_ENTRIES_ALL / KUBE_* are multi-line blocks assembled by the
# helpers below before _render_tmpl runs; they MUST be whitelisted so no literal
# ${...} placeholder can ever ship in a rendered artifact.
STAGES_ENVSUBST_VARS='${NODE_IPS}${CONTROL_PLANE_IP}${ACCESS_IP}${NFS_SERVER}${NFS_PATH}'\
'${APP_NAMESPACE}${BENCH_NAMESPACE}${SSH_PORT_CP}${SSH_PORT_NPU}${FRONTEND_NODEPORT}'\
'${BACKEND_NODEPORT}${MANAGED_BY}${PART_OF}${WORKER_ENTRIES}${NODE_ENTRIES_ALL}'\
'${KUBE_CONTROL_PLANE_HOSTS}${ETCD_HOSTS}${KUBE_NODE_HOSTS}'
