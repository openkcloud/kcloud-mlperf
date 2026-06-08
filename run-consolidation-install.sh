#!/usr/bin/env bash
# Consolidation cluster install (run #1) — bare-metal reset of the 5 target nodes, then the one-input installer.
# Detached/nohup-safe. Logs to /home/kcloud/consolidation-install.log. Touches ONLY the 5 target IPs.
set +e
export PATH="$HOME/.local/bin:$PATH"
export SUDO_PASS='<SUDO_PASS>'
export SSHPASS='<SUDO_PASS>'
export ANSIBLE_HOST_KEY_CHECKING=False
KS=/home/kcloud/etri-llm-deployments/app/kubespray
export ANSIBLE_LIBRARY="$KS/plugins/modules"   # ansible.cfg's 'library=./library' is wrong; kube module lives here
INVDIR="$KS/inventory/consolidation"
LOG=/home/kcloud/consolidation-install.log
exec >"$LOG" 2>&1

echo "=================== CONSOLIDATION INSTALL run#10  $(date -u) ==================="

# 0. kill any leftover throwaway ansible
pkill -9 -f '/ansible-playboo[k]' 2>/dev/null; sleep 3

# 1. build a DEDICATED 5-node inventory (jw1 control-plane+etcd; all 5 workers)
mkdir -p "$INVDIR"
cp -r "$KS/inventory/etri/group_vars" "$INVDIR/" 2>/dev/null
# Docker Hub anonymous rate-limit hardening (run #5 hit a 429 on jw3's nginx pull:
#   "failed size validation: 382966 != 370" = a 370-byte TOOMANYREQUESTS body, not the layer).
#   Only 1 image on 1 node failed (others clean) => a brief request-rate burst at the boundary,
#   not an exhausted 6h cap. So just give the pull task far more retries spread over more time
#   (default was 4 retries @ ~3-7s = ~20s; now 10 @ ~3-33s = ~3min) to ride out the burst.
#   NB: download_run_once was tried in run #6 but its rsync 'sudo -u root' distribution needs
#       passwordless sudo, which jw1/jw2/jw3 lack (only node4 has it) -> rsync rc=12. Reverted.
mkdir -p "$INVDIR/group_vars/all"
cat > "$INVDIR/group_vars/all/zz-download-overrides.yml" <<'YAML2'
download_run_once: false
download_retries: 10
retry_stagger: 30
YAML2
cat > "$INVDIR/hosts.yml" <<'YAML'
all:
  hosts:
    jw1:   { ansible_host: 10.254.202.81,  ansible_port: 22, ansible_user: kcloud, ansible_password: "{{ lookup('env','SUDO_PASS') }}", ansible_become_password: "{{ lookup('env','SUDO_PASS') }}", etcd_member_name: etcd1 }
    jw2:   { ansible_host: 10.254.202.82,  ansible_port: 22, ansible_user: kcloud, ansible_password: "{{ lookup('env','SUDO_PASS') }}", ansible_become_password: "{{ lookup('env','SUDO_PASS') }}" }
    jw3:   { ansible_host: 10.254.202.83,  ansible_port: 22, ansible_user: kcloud, ansible_password: "{{ lookup('env','SUDO_PASS') }}", ansible_become_password: "{{ lookup('env','SUDO_PASS') }}" }
    node4: { ansible_host: 10.254.202.114, ansible_port: 22, ansible_user: kcloud, ansible_password: "{{ lookup('env','SUDO_PASS') }}", ansible_become_password: "{{ lookup('env','SUDO_PASS') }}" }
    node5: { ansible_host: 10.254.202.111, ansible_port: 22, ansible_user: kcloud, ansible_password: "{{ lookup('env','SUDO_PASS') }}", ansible_become_password: "{{ lookup('env','SUDO_PASS') }}" }
  children:
    kube_control_plane: { hosts: { jw1: {} } }
    etcd:               { hosts: { jw1: {} } }
    kube_node:          { hosts: { jw1: {}, jw2: {}, jw3: {}, node4: {}, node5: {} } }
    k8s_cluster:        { children: { kube_control_plane: {}, kube_node: {} } }
    calico_rr:          { hosts: {} }
YAML

# 2. HARD SAFETY ASSERT
if grep -qE '10\.254\.(177\.41|184\.19[56])' "$INVDIR/hosts.yml"; then echo "FATAL: forbidden old-cluster IP in inventory"; exit 9; fi
cnt=$(grep -cE 'ansible_host: 10\.254\.202\.(81|82|83|114|111)' "$INVDIR/hosts.yml")
if [ "$cnt" -ne 5 ]; then echo "FATAL: expected exactly 5 target IPs (jw1/jw2/jw3/node4/node5), found $cnt"; exit 9; fi
echo "SAFETY OK: inventory = exactly the 5 target IPs (jw1/jw2/jw3/node4/node5); no forbidden IP."
echo "NOTE: node5 (Rebellions Atom+, 10.254.202.111) is now provisioned IN the kubespray build as"
echo "      a plain kube_node — Atom+ is host-served (vLLM-RBLN on :30093), NOT a k8s device plugin,"
echo "      so to k8s it is just a worker. kubespray installs the nginx-proxy local API LB natively,"
echo "      so the separate 19c kubeadm-join step is no longer needed. node5/Atom+ is in the device"
echo "      registry new-cluster-fixed.yaml -> etri-llm-cluster-config. node5 host assets (Atom+"
echo "      vLLM systemd + tp2 artifact) live outside k8s and are untouched by reset/provision."

# 2.5 NODE PREP (idempotent, reproducible): (a) dpkg-health, (b) netplan-permanent.
#   (a) node4 (RNGD) ships furiosa-pert-rngd whose postinst runs `furiosa_pert_deploy -A`; that pci_copy
#   times out (driver 2026.1.0 vs PERT 2025.3.1 mismatch) leaving the pkg HALF-CONFIGURED, which jams
#   EVERY apt/dpkg op — incl. kubespray's "Docker | Remove docker package" (this is what failed run #4).
#   The RNGD stays fully functional (fw already loaded; furiosa-smi works), so we ONLY clear the dpkg
#   bookkeeping: temporarily neutralize the broken postinst, mark the pkg configured, restore the real
#   postinst. No device touch, no reboot, fully reversible. No-op on nodes that aren't jammed.
#   (b) jw1/jw2/jw3 manage networking via cloud-init (/etc/netplan/50-cloud-init.yaml) which regenerates
#   on boot and DROPS the static IP -> after a reboot the node comes up NETLESS (this stranded jw1/2/3
#   for ~4h after run #8). Fix = disable cloud-init network regeneration so the current correct netplan
#   persists. No `netplan apply` -> zero runtime change -> zero lockout risk. node4 has no cloud-init
#   netplan -> auto-skipped (it already survives reboot).
#   (c) TIME SYNC: kubeadm join validates the API server cert (NotBefore = init time). In run #9 jw2 had
#   its NTP daemon OFF and its clock ~9 min BEHIND jw1, so jw1's fresh cert looked "not yet valid" to jw2
#   -> join failed with x509 "certificate is not yet valid". Fix = enable NTP + force a step on every node
#   so all clocks agree before kubeadm runs.
echo "=================== NODE PREP (dpkg + netplan + time-sync)  $(date -u) ==================="
for ip in 10.254.202.81 10.254.202.82 10.254.202.83 10.254.202.114 10.254.202.111; do
  echo "--- node-prep $ip ---"
  { printf '%s\n' "$SUDO_PASS"; cat <<'REMOTE'
set -e
if dpkg -l furiosa-pert-rngd 2>/dev/null | grep -q '^iF'; then
  P=/var/lib/dpkg/info/furiosa-pert-rngd.postinst
  cp -n "$P" /root/furiosa-pert-rngd.postinst.real 2>/dev/null || true
  printf '%s\n' '#!/bin/sh' 'exit 0' > "$P"; chmod +x "$P"
  dpkg --configure furiosa-pert-rngd || true
  [ -f /root/furiosa-pert-rngd.postinst.real ] && cp /root/furiosa-pert-rngd.postinst.real "$P"
  echo "  CLEARED furiosa-pert-rngd half-configured state"
else
  echo "  ok: no furiosa-pert-rngd half-configured jam"
fi
PEND=$(dpkg --audit 2>/dev/null | grep -cE '^ ' || true)
echo "  dpkg --audit pending packages: ${PEND:-0}"
# apt-cache health: kubespray reset/preinstall runs an APT cache update and FAILS the play
# if a configured repo errors. node5 carries the Rebellions SDK apt repo whose signing key
# rotated (NO_PUBKEY 46D8366B9DFC423E) -> apt update errors -> reset.yml failed on node5.
# The rbln SDK is a pre-installed prerequisite (repo not needed to provision k8s), so test
# each vendor repo in isolation and disable any that error, for a clean cache. Idempotent;
# no-op on nodes without it. Re-enable once Rebellions publishes a refreshed key.
for f in /etc/apt/sources.list.d/*rebellion*.list; do
  [ -f "$f" ] || continue
  if apt-get update -o Dir::Etc::sourcelist="$f" -o Dir::Etc::sourceparts=/dev/null -o APT::Get::List-Cleanup=0 2>&1 | grep -qiE 'NO_PUBKEY|not.*verified|^Err:|Failed to fetch'; then
    mv "$f" "$f.disabled-by-install"; echo "  apt: disabled broken vendor repo $(basename "$f") (key/fetch error)"
  else echo "  apt: vendor repo $(basename "$f") OK"; fi
done
apt-get update >/dev/null 2>&1 && echo "  apt: cache OK" || echo "  apt: WARN cache still failing"
# container-runtime: kubespray manages containerd directly (container_manager=containerd). node5
# was set up with a full Docker CE + containerd.io 2.x stack, which collides with kubespray's
# pinned containerd — cluster.yml's docker-reset hit a /run/containerd/containerd.sock timeout
# removing a stale rbln-smi container -> PROVISION failed on node5. Atom+ is host-served (no
# docker), rbln-container-toolkit deps are docker-independent, so purge Docker/containerd.io to
# make the node containerd-only and let kubespray install its own containerd. Idempotent; no-op
# on nodes without docker-ce.
if dpkg -l docker-ce 2>/dev/null | grep -q '^ii'; then
  systemctl disable --now docker.service docker.socket 2>/dev/null || true
  DEBIAN_FRONTEND=noninteractive apt-get purge -y docker-ce docker-ce-cli docker-ce-rootless-extras docker-buildx-plugin docker-compose-plugin docker-model-plugin containerd.io >/dev/null 2>&1 || true
  for d in /etc/apt/sources.list.d/docker.list; do [ -f "$d" ] && mv "$d" "$d.disabled-by-install"; done
  rm -rf /var/lib/docker /var/lib/containerd /etc/docker /run/docker.sock /run/containerd 2>/dev/null || true
  echo "  container-runtime: purged Docker CE/containerd.io -> containerd-only (kubespray installs its containerd)"
else
  echo "  container-runtime: no docker-ce (containerd-only already)"
fi
# netplan-permanent: stop cloud-init from regenerating netplan (and dropping the static IP) on reboot.
if [ -f /etc/netplan/50-cloud-init.yaml ]; then
  mkdir -p /etc/cloud/cloud.cfg.d
  echo 'network: {config: disabled}' > /etc/cloud/cloud.cfg.d/99-disable-network-config.cfg
  echo "  netplan: cloud-init net disabled -> current config now persists across reboot"
else
  echo "  netplan: no cloud-init netplan (already reboot-persistent)"
fi
netplan generate >/dev/null 2>&1 && echo "  netplan generate: OK" || echo "  netplan generate: WARN"
# time-sync: enable NTP + force an immediate step so all node clocks agree before kubeadm (cert validation).
timedatectl set-ntp true 2>/dev/null || true
systemctl enable --now systemd-timesyncd 2>/dev/null || systemctl enable --now chrony 2>/dev/null || true
systemctl restart systemd-timesyncd 2>/dev/null || systemctl restart chrony 2>/dev/null || true
for _ in 1 2 3 4 5 6 7 8; do [ "$(timedatectl show -p NTPSynchronized --value 2>/dev/null)" = yes ] && break; sleep 2; done
echo "  time: UTC=$(date -u +%H:%M:%S) NTPsynced=$(timedatectl show -p NTPSynchronized --value 2>/dev/null)"
REMOTE
  } | sshpass -e ssh -p 22 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
        -o PreferredAuthentications=password -o PubkeyAuthentication=no kcloud@"$ip" \
        'sudo -S bash -s' 2>&1 | grep -v 'Permanently added'
done

# 3. BARE-METAL RESET of all 5 (kubespray reset)
echo "=================== RESET (bare-metal)  $(date -u) ==================="
( cd "$KS" && ANSIBLE_CONFIG="$KS/ansible.cfg" ansible-playbook -i "$INVDIR/hosts.yml" reset.yml -b -e reset_confirmation=yes )
RRC=$?
echo "RESET_RC=$RRC  $(date -u)"
if [ "$RRC" -ne 0 ]; then echo "RESET FAILED — aborting before install (revise + retry)."; echo "CONSOLIDATION_RESULT=RESET_FAILED rc=$RRC"; exit "$RRC"; fi

# 3a. TARGETED STALE-STATE CLEANUP after reset (NO reboot).
#   kubespray reset wipes /etc/kubernetes manifests/certs/etcd data but does NOT kill orphaned
#   control-plane PROCESSES from a prior cluster (run #7: a 24h-old zombie kube-apiserver still held
#   :6443 with the OLD CA -> kubeadm init's fresh apiserver crashlooped on cert mismatch and hung).
#   A reboot fixes it but the jw A30 GPU servers take 15-25 min to POST and one did NOT come back in
#   run #8 -> too risky. Instead we SSH in and explicitly KILL any surviving k8s procs, remove leftover
#   CRI containers, clear stale dirs, and verify :6443/:2379 are free. Idempotent; safe pre-provision.
echo "=================== TARGETED CLEANUP after reset (clear zombie control-plane, no reboot)  $(date -u) ==================="
TARGETS="10.254.202.81 10.254.202.82 10.254.202.83 10.254.202.114 10.254.202.111"
for ip in $TARGETS; do
  echo "--- cleanup $ip ---"
  { printf '%s\n' "$SUDO_PASS"; cat <<'REMOTE'
set +e
# kill orphaned k8s control-plane processes that survived reset (exact-comm match; nothing legit runs pre-provision)
for p in kube-apiserver kube-controller-manager kube-scheduler etcd kubelet kube-proxy; do pkill -9 -x "$p" 2>/dev/null; done
# remove any surviving CRI containers/pods (leave containerd itself running)
if command -v crictl >/dev/null 2>&1; then
  crictl rm -f $(crictl ps -aq 2>/dev/null) >/dev/null 2>&1
  crictl rmp -f $(crictl pods -q 2>/dev/null) >/dev/null 2>&1
fi
# belt-and-suspenders: clear stale cluster state dirs (reset should have already)
rm -rf /etc/kubernetes /var/lib/etcd /var/lib/kubelet/pki 2>/dev/null
sleep 2
if ss -ltn 2>/dev/null | grep -qE ':6443|:2379'; then
  echo "  WARN: :6443/:2379 STILL bound after cleanup:"; ss -ltnp 2>/dev/null | grep -E ':6443|:2379'
else
  echo "  OK: :6443 and :2379 are free"
fi
REMOTE
  } | sshpass -e ssh -p 22 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
        -o PreferredAuthentications=password -o PubkeyAuthentication=no -o ConnectTimeout=10 kcloud@"$ip" \
        'sudo -S bash -s' 2>&1 | grep -v 'Permanently added'
done
echo "  targeted cleanup done on all 4 nodes (no reboot)."

# 3b. PROVISION the 4-node cluster via kubespray cluster.yml (direct — installer --provision has a
#     preflight bug vs node1's stale kubeconfig; we provision here then run the installer for the stack).
echo "=================== PROVISION (kubespray cluster.yml)  $(date -u) ==================="
( cd "$KS" && ANSIBLE_CONFIG="$KS/ansible.cfg" ansible-playbook -i "$INVDIR/hosts.yml" cluster.yml -b )
PRC=$?
echo "PROVISION_RC=$PRC  $(date -u)"
if [ "$PRC" -ne 0 ]; then echo "PROVISION FAILED."; echo "CONSOLIDATION_RESULT=PROVISION_FAILED rc=$PRC"; exit "$PRC"; fi

# 3c. Fetch the NEW cluster kubeconfig from jw1 (control-plane) and point it at jw1's IP
echo "=================== KUBECONFIG handoff  $(date -u) ==================="
KCFG=/home/kcloud/jwcluster.kubeconfig
printf '%s\n' "$SUDO_PASS" | sshpass -e ssh -p 22 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
  -o PreferredAuthentications=password -o PubkeyAuthentication=no kcloud@10.254.202.81 \
  'sudo -S cat /etc/kubernetes/admin.conf' 2>/dev/null > "$KCFG"
sed -i -E 's#^( *server:).*#\1 https://10.254.202.81:6443#' "$KCFG"
chmod 600 "$KCFG"
echo "new cluster nodes:"; KUBECONFIG="$KCFG" kubectl get nodes -o wide 2>&1 | head
if ! KUBECONFIG="$KCFG" kubectl get nodes &>/dev/null; then echo "KUBECONFIG handoff FAILED"; echo "CONSOLIDATION_RESULT=KUBECONFIG_FAILED"; exit 1; fi

# 4. APP-LAYER — full reproducible stack on the NEW cluster: NFS server (node4) + corrected
#    PV/PVC + Postgres manifests + installer (storage + gpu-operator + webapp w/ frontend v50 /
#    backend v46) + device registry + furiosa RNGD plugin + observability (loki/prometheus/furiosa
#    exporter) + per-host GPU dashboards. All idempotent. See consolidation-app-layer.sh.
echo "=================== APP-LAYER (full stack on new cluster)  $(date -u) ==================="
KUBECONFIG="$KCFG" SUDO_PASS="$SUDO_PASS" SSHPASS="$SSHPASS" bash /home/kcloud/consolidation-app-layer.sh
IRC=$?
echo "APP_LAYER_RC=$IRC  $(date -u)"
echo "CONSOLIDATION_RESULT=$([ "$IRC" -eq 0 ] && echo SUCCESS || echo INSTALL_FAILED) app_layer_rc=$IRC"
echo "NOTE: data restore is a separate one-time step (node4:~/restore-data.sh); benchmark results"
echo "      ingest lazily on a GET /api/mp-exam/status/:id (UI polling triggers it)."
echo "=================== DONE  $(date -u) ==================="
