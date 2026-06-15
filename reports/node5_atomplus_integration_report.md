# node5 Rebellions Atom+ Integration Report

**RUN_ID**: 20260428-083516-4b786d4
**Branch**: `fix/p0-node5-rebellions-realtime-comparison-sweep-20260428-083516-4b786d4`
**Status**: ✅ **JOINED + LABELED + READY** — Gate G1 ACHIEVED
**Integrated**: 2026-04-29 ~01:27 UTC (after ~25 min of debugging)

## Hardware (verified)

| Property | Value |
|---|---|
| Hostname | rebellion-atom-1 |
| IP | 10.254.202.111:22 |
| OS | Ubuntu 22.04.5 LTS |
| Kernel | 6.8.0-40-generic |
| CPU | 96 cores x86_64 |
| RAM | 1.5 TiB |
| Disk | 876 GB |
| Accelerator vendor | **Rebellions** (PCI vendor `1eff`, NOT FuriosaAI `1ed2`) |
| Accelerator model | Atom+ |
| Accelerator count | 2 (PCI `1eff:1220` rev 03 at `c3:00.0` and `c4:00.0`) |
| Device files | `/dev/rsd0` |
| Vendor tools | `/usr/local/bin/rbln-stat`, `/usr/local/bin/rbln-smi` |

## Cluster state (post-integration)

| Node | Status | Version | InternalIP | Container Runtime |
|---|---|---|---|---|
| node1 | Ready (control-plane) | v1.28.12 | 10.254.177.41 | containerd://1.7.21 |
| node2 | Ready (worker) | v1.28.12 | 10.254.184.195 | containerd://1.7.21 |
| node3 | Ready (worker) | v1.28.12 | 10.254.184.196 | containerd://1.7.21 |
| node4 | Ready (worker, RNGD NPU) | v1.28.12 | 10.254.202.114 | containerd://1.7.21 |
| **node5** | **Ready** (worker, Rebellions Atom+) | **v1.28.0** | **10.254.202.111** | **containerd://1.7.22** |

Version drift: node5 is on 1.28.0 vs cluster 1.28.12 (minor patch difference). Within k8s version skew policy (worker nodes can lag control-plane by up to 1 minor version). Recommend upgrading to 1.28.12 in a follow-up maintenance window — not blocking.

## Labels applied

```
accelerator-count=2
accelerator-type=npu
benchmark.openkcloud.io/role=benchmark-worker
npu-model=atomplus
npu-vendor=rebellions
+ kubernetes.io/{arch,os,hostname}, beta.kubernetes.io/{arch,os}
```

## System pods on node5

| Pod | Status |
|---|---|
| calico-node-gv2qp | Running 1/1 |
| kube-proxy-ln7qs | Running 1/1 |
| nginx-proxy-node5 | Running 1/1 |
| nodelocaldns-r2fkx | Running 1/1 |

## Defects encountered + fixes (chronological)

The join was non-trivial — node5 was previously joined to a DIFFERENT cluster and carried significant stale state. The following blockers were identified and fixed:

### Defect 1 — Vendor mislabeling (caught pre-join)
- **Symptom**: scaffold labeled node5 as Furiosa Atom+
- **Reality**: PCI vendor `1eff` is Rebellions (Furiosa is `1ed2`)
- **Fix**: worker-3 corrected `config/cluster.yaml`, renamed `furiosa-atomplus-device-plugin.yaml.template` → `rebellions-atomplus-device-plugin.yaml.template`, renamed `07_prepare_atomplus_npu_nodes.sh` → `07_prepare_rebellions_atomplus_npu_nodes.sh`. Kubespray inventory updated with vendor=rebellions and `$SUDO_PASS` env reference (no literal password).

### Defect 2 — Install script failure (sudo NOPASSWD + stdin pipe collision)
- **Symptom**: `bash: line 1: <SUDO_PASS>: command not found` during Step 2 install
- **Root cause**: node5 has `sudo NOPASSWD` configured (file `/etc/sudoers.d/kcloud-nopasswd`), so `sudo -S` did not consume the password line from stdin. The `echo $SUDO_PASS | sudo -S bash -s` pattern then leaked the password as bash's first stdin line, which bash tried to execute as a command.
- **Discovered**: node5 already had containerd v1.7.22, kubelet v1.28.0, kubeadm v1.28.0 from a previous (aborted) join attempt
- **Fix**: skipped Step 2 install, used existing components

### Defect 3 — Stale kubeadm state from previous cluster
- **Symptom**: `/etc/kubernetes/kubeadm-client.conf.<dot>.<timestamp>` files dated 2026-04-21
- **Fix**: `sudo kubeadm reset -f` on node5 to clear all prior k8s state

### Defect 4 — Stale IPVS rules pointing to phantom apiserver
- **Symptom**: After kubelet started, `ipvsadm -L` showed `10.233.0.1:443 → 10.254.202.91:6443` (a dead IP from a previous cluster instance) — current cluster uses `10.254.177.41:6443`. No service entries for fresh apiserver.
- **Fix**: `ipvsadm --clear`, `iptables -t nat -F`, restart kube-proxy pod

### Defect 5 — iptables backend mismatch (nft vs legacy)
- **Symptom**: `iptables v1.8.7 (nf_tables): chain 'KUBE-SERVICES' in table 'nat' is incompatible, use 'nft' tool` — node5 was using `iptables-nft` while the rest of the cluster (and calico image) uses `iptables-legacy`
- **Fix**: `update-alternatives --set iptables /usr/sbin/iptables-legacy`, `nft flush ruleset`, restart kubelet

### Defect 6 — kube-proxy unable to reach apiserver
- **Symptom**: kube-proxy logs `dial tcp 127.0.0.1:6443: connect: connection refused` (cluster uses HA pattern where every worker has localhost nginx-proxy that load-balances to control-plane apiservers)
- **Root cause**: node5's `/etc/kubernetes/manifests/` did not have `nginx-proxy.yml` static pod manifest
- **Fix**: copied `/etc/kubernetes/manifests/nginx-proxy.yml` from node4 → node5

### Defect 7 — nginx-proxy upstream pointing to phantom apiserver
- **Symptom**: After nginx-proxy started, TLS verification still failed. nginx serving cert `84:BD:14:DB:90:85:46:BF:79:8E:C3:2B:D3:5D:4B:9B:63:E5:DC:90` (from upstream `10.254.202.91:6443` — dead/phantom) instead of cluster apiserver cert `A0:1D:6F:26:BB:82:FE:82:92:1B:77:FD:45:E9:8C:C4:C8:55:CB:44`
- **Root cause**: node5's `/etc/nginx/nginx.conf` (host volume mounted into the static pod) had `upstream { server 10.254.202.91:6443; }` from the previous cluster
- **Fix**: copied node4's `/etc/nginx/` directory to node5 (correct upstream `10.254.177.41:6443`), then restarted nginx-proxy container so it reloaded config

## Device plugin status (deferred — Gate G2 partial)

The Rebellions Atom+ device plugin was **NOT applied** during this integration. Reason:

- The diagnostic-only DaemonSet template in `k8s/device-plugins/rebellions-atomplus-device-plugin.yaml.template` references `${RBLN_PLUGIN_IMAGE}:${RBLN_PLUGIN_TAG}` defaulting to `rebellions/k8s-device-plugin:atomplus-v1.0.0` which does not exist on Docker Hub.
- No upstream Rebellions Kubernetes device plugin is publicly available as of 2026-04-29.
- node5 is **NOT advertising** `rebellions.ai/atomplus` in `Allocatable`. Benchmark workloads must access `/dev/rsd0` via `hostPath + securityContext.privileged: true` until a real Rebellions device plugin ships.

The integration script `scripts/19_join_node5.sh` was run with `SKIP_DEVICE_PLUGIN=true` to avoid creating a CrashLoopBackOff pod.

## Rerun + rollback commands

**To rejoin node5 (after a reset):**
```bash
# Step 1 — reset (if needed):
sshpass -p $SUDO_PASS ssh -p 22 kcloud@10.254.202.111 'sudo kubeadm reset -f && sudo iptables -t nat -F && sudo ipvsadm --clear && sudo nft flush ruleset'

# Step 2 — get fresh join cmd from node1 (and patch loopback IP):
JOIN_CMD=$(kubeadm token create --print-join-command | sed 's|127.0.0.1:6443|10.254.177.41:6443|')

# Step 3 — execute join + ensure prerequisites:
sshpass -p $SUDO_PASS ssh -p 22 kcloud@10.254.202.111 "sudo update-alternatives --set iptables /usr/sbin/iptables-legacy && sudo $JOIN_CMD --node-name node5"

# Step 4 — copy nginx config + manifest from node4 (HA loopback proxy):
sshpass -p $SUDO_PASS ssh kcloud@10.254.202.114 'sudo tar czf /tmp/nginx-conf.tgz -C /etc nginx; sudo chmod 644 /tmp/nginx-conf.tgz'
sshpass -p $SUDO_PASS scp -P 22 kcloud@10.254.202.114:/tmp/nginx-conf.tgz /tmp/
sshpass -p $SUDO_PASS scp -P 22 /tmp/nginx-conf.tgz kcloud@10.254.202.111:/tmp/
sshpass -p $SUDO_PASS ssh kcloud@10.254.202.114 'sudo cat /etc/kubernetes/manifests/nginx-proxy.yml' > /tmp/nginx-proxy.yml
sshpass -p $SUDO_PASS scp -P 22 /tmp/nginx-proxy.yml kcloud@10.254.202.111:/tmp/
sshpass -p $SUDO_PASS ssh -p 22 kcloud@10.254.202.111 'sudo tar xzf /tmp/nginx-conf.tgz -C /etc && sudo cp /tmp/nginx-proxy.yml /etc/kubernetes/manifests/nginx-proxy.yml'

# Step 5 — apply labels:
for L in accelerator-type=npu npu-vendor=rebellions npu-model=atomplus accelerator-count=2 benchmark.openkcloud.io/role=benchmark-worker; do
  kubectl label node node5 $L --overwrite
done
```

**Rollback (remove node5 from cluster):**
```bash
kubectl drain node5 --ignore-daemonsets --delete-emptydir-data --force
sshpass -p $SUDO_PASS ssh -p 22 kcloud@10.254.202.111 'sudo kubeadm reset -f'
kubectl delete node node5
# Pre-state available at: .omc/checkpoints/20260428-083516-4b786d4/{nodes,helm-values,deployments}-before.yaml
```

## Acceptance gate verdict

- **G1 (node5 joined+labeled+device-detected+schedulable, OR documented blocker)**: ✅ PASS — joined + labeled + Ready. Device plugin (schedulable allocatable) DEFERRED with documented blocker (no upstream Rebellions plugin).
- **G2 (Rebellions Atom+ represented separately from RNGD/Furiosa/NVIDIA)**: ✅ PASS — vendor labels enforce distinction.

## Files changed

In `/home/kcloud/etri-llm-deployments/app`:
- `config/cluster.yaml` (vendor: rebellions)
- `k8s/device-plugins/rebellions-atomplus-device-plugin.yaml.template` (renamed)
- `scripts/07_prepare_rebellions_atomplus_npu_nodes.sh` (renamed)
- `scripts/18_validate_node5_atomplus.sh` (new)
- `scripts/19_join_node5.sh` (new)
- `kubespray/inventory/etri/hosts.yml` (node5 added with $SUDO_PASS env reference)
- `docs/node5_atomplus_runbook.md` (new)

In `/home/kcloud/etri-llm-exam-solution`:
- `.omc/checkpoints/20260428-083516-4b786d4/{nodes-before.yaml, nodes-after.yaml, helm-values-before.yaml, helm-history-before.txt, deployments-before.yaml, join-command.txt}` (new)
- `.omc/plans/p0-zero-known-defect-stabilization.md` (new)
- `reports/node5_atomplus_integration_report.md` (this file)
- `docs/node5_atomplus_runbook.md` (new — copied from infra repo)

On `node5` (rebellion-atom-1):
- `/etc/nginx/` populated from node4 (correct upstream)
- `/etc/kubernetes/manifests/nginx-proxy.yml` added
- `/etc/alternatives/iptables` switched to legacy
