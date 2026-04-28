# Test Validation Report
RUN_ID: 20260428-072038-a612a54
Generated: 2026-04-28
Verifier lane: oh-my-claudecode:verifier (Sonnet 4.6)

---

## BLOCKED: Missing Prerequisites

The following required items were NOT present at verification time:

| Item | Status | Notes |
|------|--------|-------|
| `scripts/00_preflight_master.sh` | PRESENT | |
| `scripts/01_preflight_workers.sh` | PRESENT | |
| `scripts/02_sync_ssh_and_credentials.sh` | PRESENT | (not named in spec but present) |
| `scripts/03_*.sh` through `scripts/17_*.sh` | **MISSING** | None of scripts 03–17 exist |
| `config/cluster.yaml` | PRESENT | |
| `config/credentials.example.env` | PRESENT | |
| `config/benchmark_profiles.yaml` | PRESENT | |
| `config/model_profiles.yaml` | **MISSING** | File does not exist |
| `scripts/common.sh` | PRESENT | |
| `k8s/namespaces/` | PRESENT | |
| `k8s/secrets/` | PRESENT | |
| `k8s/device-plugins/` | PRESENT | |
| `k8s/benchmark-jobs/` | PRESENT | |
| `reports/` (>=6 files) | PRESENT | 8 files found (including this report) |
| `docs/` (>=6 files) | PRESENT | 6 files found (including Korean manual) |
| `results/20260428-072038-a612a54/tt100_runner.py` | **MISSING** | results/ tree is empty |

**BLOCKED items (3):** scripts 03–17, `config/model_profiles.yaml`, `results/${RUN_ID}/tt100_runner.py`.
Verification proceeds on available files; blockers are recorded.

---

## Static Checks Summary

| Check | Passed | Failed | Skipped | Notes |
|-------|--------|--------|---------|-------|
| Shell syntax (`bash -n`) | 11/11 | 0 | 0 | All scripts/*.sh clean |
| shellcheck | N/A | N/A | 11 | Tool not installed in this environment |
| YAML lint (new files: config/, k8s/) | 4/6 | 2/6 | 0 | See YAML errors section |
| YAML lint (helm templates: kubernetes/) | Not gating | — | — | Helm templates use `{{` syntax; `yaml.safe_load` cannot parse them; expected non-error |
| kubectl dry-run | 2/4 | 2/4 | 0 | See kubectl errors section |
| Secret scan (new files) | WARN | — | — | `<SUDO_PASS>` found in scripts/add-node.sh and config/credentials.example.env |
| Secret scan (pre-existing) | MEDIUM | — | — | kubespray/inventory/etri/hosts.yml; kubernetes/app-chart/values.yaml |

---

## Shellcheck Findings

shellcheck was not available in this environment (`command -v shellcheck` returned no result).
Recommendation: install shellcheck (`apt-get install shellcheck`) and re-run before production deployment.

---

## YAML Errors

### New files (config/, k8s/) — GATING

**1. `k8s/namespaces/00-namespaces.yaml`**
- Error: `yaml.safe_load` rejects multi-document streams. The file uses `---` separators to define 3 Namespace objects in one file, which is valid Kubernetes YAML but requires `yaml.safe_load_all` (not `yaml.safe_load`).
- Assessment: **FALSE POSITIVE**. The file is structurally correct multi-document YAML. `kubectl apply --dry-run=server` succeeded on this file. Not a real error.

**2. `k8s/storage/nfs-pvc-template.yaml`**
- Error: Same multi-document issue — 3 PersistentVolumeClaim objects separated by `---`.
- Assessment: **FALSE POSITIVE**. Valid multi-document YAML. `yaml.safe_load_all` confirms 3 well-formed PVC documents.

**Conclusion**: Both YAML "errors" are false positives caused by the lint command using `yaml.safe_load` instead of `yaml.safe_load_all`. No actual YAML syntax problems exist in config/ or k8s/.

### Helm templates (kubernetes/alloy-1.4.0/templates/, etc.) — NON-GATING

Helm chart templates contain `{{ }}` Go template syntax that is invalid plain YAML. These are expected to fail `yaml.safe_load` and are not subject to this gate. Files affected include:
- `kubernetes/alloy-1.4.0/templates/cluster_service.yaml`
- `kubernetes/alloy-1.4.0/templates/configmap.yaml`
- `kubernetes/alloy-1.4.0/templates/containers/_agent.yaml`
- `kubernetes/alloy-1.4.0/templates/containers/_watch.yaml`
- `kubernetes/alloy-1.4.0/templates/controllers/daemonset.yaml`
- `kubernetes/alloy-1.4.0/templates/controllers/deployment.yaml`
- (and other helm chart templates)

These are pre-existing helm chart files and are not gating.

---

## kubectl dry-run Errors

Files checked: all `k8s/**/*.yaml` excluding `*.template` files.

| File | Result | Analysis |
|------|--------|----------|
| `k8s/device-plugins/furiosa-rngd-device-plugin.yaml` | OK | Passed |
| `k8s/namespaces/00-namespaces.yaml` | OK | Passed (multi-doc handled by kubectl) |
| `k8s/device-plugins/nvidia-gpu-operator-values.yaml` | **ERROR** | Helm values file — no `apiVersion`/`kind`; not a kubectl manifest |
| `k8s/storage/nfs-pvc-template.yaml` | **ERROR** | PVCs already exist in cluster with different storageClass/volumeName; immutability conflict |

**Analysis of errors:**

1. **`nvidia-gpu-operator-values.yaml`** — This is a Helm values file (first line is a comment: `# NVIDIA GPU Operator Helm values`). It has no `apiVersion` or `kind` and is not intended for `kubectl apply`. Applying it via `kubectl` is incorrect usage. **Not a manifest defect; wrong tool applied.** Risk: LOW.

2. **`nfs-pvc-template.yaml`** — The PVCs (`model-nfs-pvc`, `dataset-nfs-pvc`, `results-nfs-pvc`) already exist in the live cluster with a bound PV (`model-nfs-pv`, etc., storageClass `""`). The template specifies `storageClassName: nfs-client` and smaller storage sizes, which conflicts with the immutable bound spec. This is a **real conflict between the template and the live cluster state**. The template needs to be reconciled with live state before it can be safely applied. Risk: **MEDIUM** — applying this manifest would fail with an error (not silently corrupt); it does not represent a safety hazard but does indicate the template is out of sync with the cluster.

---

## Secret Scan Results

### NEW files (scripts/, config/, k8s/, results/, docs/, reports/) — GATING

| Severity | File | Line | Pattern | Preview |
|----------|------|------|---------|---------|
| **HIGH** | `scripts/add-node.sh` | 5 | `<SUDO_PASS>` (literal password in comment as default example) | `./add-node.sh ... [--password ***REDACTED***]` |
| **HIGH** | `scripts/add-node.sh` | 27 | `<SUDO_PASS>` (hardcoded default in variable) | `PASSWD="${ANSIBLE_PASSWORD:-***REDACTED***}"` |
| MEDIUM | `config/credentials.example.env` | 8 | `<SUDO_PASS>` (reference in comment) | `SUDO_PASS= # node sudo password (kubespray inventory uses '***REDACTED***')` |
| MEDIUM | `reports/repo_architecture_audit.md` | 61, 105, 119 | `<SUDO_PASS>` (in audit prose, already flagged as Critical) | Audit text referencing the pre-existing leak |
| MEDIUM | `docs/REPOSITORY_AND_MIGRATION_STRATEGY.md` | 442, 453, 573 | `<SUDO_PASS>` (in migration strategy doc) | Korean doc noting password must be rotated |
| MEDIUM | `docs/INSTALL_AND_DEPLOY_GUIDE.md` | 462, 1498 | `<SUDO_PASS>` (in install guide warning) | Warning to operators to remove plaintext password |

**Assessment of HIGH findings:**

- `scripts/add-node.sh:27` — `PASSWD="${ANSIBLE_PASSWORD:-<SUDO_PASS>}"` — this hardcodes the live cluster password as the default fallback. If `ANSIBLE_PASSWORD` is unset, the script will use the real password. **This is a HIGH severity secret exposure in a new autopilot-authored file.** This IS a gate blocker.
- `scripts/add-node.sh:5` — comment documenting the default — secondary exposure.
- `config/credentials.example.env:8` — comment-only, no actual value assigned; MEDIUM.
- Doc/report files — prose references to an already-known credential; MEDIUM (informational).

**GitHub PAT, Docker Hub token, HuggingFace token, private keys, dockerConfigJson base64**: NONE found in new files.

### PRE-EXISTING files (kubespray/, kubernetes/app-chart/) — NON-GATING

| Severity | File | Pattern |
|----------|------|---------|
| MEDIUM (pre-existing) | `kubespray/inventory/etri/hosts.yml:7–29` | `ansible_password` and `ansible_become_password` with `<SUDO_PASS>` committed for all 4 nodes |
| MEDIUM (pre-existing) | `kubernetes/app-chart/values.yaml:6` | `dockerConfigJson: ***REDACTED***` (base64 Docker Hub token) |
| LOW (pre-existing) | `kubespray/docs/advanced/cert_manager.md:98` | `-----BEGIN CERTIFICATE-----` (example cert in docs) |
| LOW (pre-existing) | `kubespray/inventory/etri/group_vars/...addons.yml:162` | `#   -----BEGIN` (commented-out example) |

These are flagged MEDIUM/LOW but do not gate this autopilot pass per instructions (already in remote).

---

## Verdict

**FAIL**

Blocking issues:
1. **SECRET LEAK (HIGH)** — `scripts/add-node.sh:27` hardcodes `<SUDO_PASS>` as a default password value in a new autopilot-authored file.
2. **MISSING PREREQUISITES** — scripts 03–17 absent, `config/model_profiles.yaml` absent, `results/${RUN_ID}/tt100_runner.py` absent. The autopilot lanes that were supposed to produce these files did not complete.

Non-blocking issues (WARN):
- `k8s/storage/nfs-pvc-template.yaml` is out of sync with live cluster PVC bindings.
- `k8s/device-plugins/nvidia-gpu-operator-values.yaml` is misclassified as a kubectl manifest in the k8s/ tree (it is a Helm values file).
- shellcheck was unavailable; manual review of scripts recommended before production use.
- `config/credentials.example.env` references `<SUDO_PASS>` in a comment; should be genericized.
