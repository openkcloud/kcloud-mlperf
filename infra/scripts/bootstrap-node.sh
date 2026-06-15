#!/usr/bin/env bash
# bootstrap-node.sh — prepare a fresh Ubuntu 22.04 host to be a kube node.
#
# Run this once on every NEW node before kubespray scale.yml. It installs the
# bare-metal prerequisites kubespray expects (containerd, kernel modules, sysctl,
# swap-off). Idempotent — safe to re-run.
#
# Usage:
#   ./bootstrap-node.sh               # bootstrap with defaults
#   ./bootstrap-node.sh --check       # dry-run, only report what would change
#   ./bootstrap-node.sh --help
#
# Exit codes:
#   0 ok / no changes
#   1 missing prerequisite (e.g. not Ubuntu 22.04)
#   2 user error (bad flag)
#   3+ operational failure (apt, sysctl, etc.)

set -euo pipefail

MODE=apply
case "${1:-}" in
  --help|-h)
    grep '^# ' "$0" | sed 's/^# //'
    exit 0
    ;;
  --check)
    MODE=check
    shift
    ;;
  '') ;;
  *)
    echo "ERROR: unknown flag '$1'. See --help." >&2
    exit 2
    ;;
esac

run() {
  if [ "$MODE" = check ]; then
    printf '[check] would run: %s\n' "$*"
  else
    printf '[apply] %s\n' "$*"
    "$@"
  fi
}

# 1. Confirm Ubuntu 22.04
if ! grep -q '22.04' /etc/os-release 2>/dev/null; then
  echo "ERROR: this script targets Ubuntu 22.04 only" >&2
  exit 1
fi

# 2. apt packages kubespray expects
APT_PKGS="apt-transport-https ca-certificates curl gnupg lsb-release \
  software-properties-common containerd ipset ipvsadm conntrack socat ebtables ethtool"
run sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
run sudo DEBIAN_FRONTEND=noninteractive apt-get install -y $APT_PKGS

# 3. Disable swap (kubelet refuses to run with swap on)
if [ "$(swapon --show | wc -l)" -gt 0 ]; then
  run sudo swapoff -a
  run sudo sed -i.bak '/\bswap\b/s/^/#/' /etc/fstab
fi

# 4. Kernel modules required by kube-proxy / cni
KMODS=(br_netfilter overlay nf_conntrack ip_vs ip_vs_rr ip_vs_wrr ip_vs_sh)
for m in "${KMODS[@]}"; do
  if ! lsmod | grep -q "^$m"; then run sudo modprobe "$m"; fi
done
run sudo bash -c 'cat > /etc/modules-load.d/etri-llm-k8s.conf <<EOF
br_netfilter
overlay
nf_conntrack
ip_vs
ip_vs_rr
ip_vs_wrr
ip_vs_sh
EOF'

# 5. Sysctl
run sudo bash -c 'cat > /etc/sysctl.d/99-etri-llm-k8s.conf <<EOF
net.bridge.bridge-nf-call-iptables=1
net.bridge.bridge-nf-call-ip6tables=1
net.ipv4.ip_forward=1
EOF'
run sudo sysctl --system -q

# 6. containerd config (use systemd cgroup driver — matches kubespray default for v1.28)
if [ ! -f /etc/containerd/config.toml ]; then
  run sudo bash -c 'mkdir -p /etc/containerd && containerd config default > /etc/containerd/config.toml'
fi
if ! grep -q 'SystemdCgroup = true' /etc/containerd/config.toml; then
  run sudo sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml
  run sudo systemctl restart containerd
fi

# 7. Open SSH port 122 + 22 for kubespray (most kubespray inventories assume 22; etri uses 122)
# (skipped — assumed already done; documented in README)

if [ "$MODE" = check ]; then
  echo "Dry-run complete. Re-run without --check to apply."
else
  echo "Bootstrap done on $(hostname). Ready for kubespray scale.yml."
fi
