# kcloud-tool

Pilot benchmark installer and tooling for the kcloud MLPerf evaluation suite.
Targets Kubernetes clusters with GPU and NPU accelerators (NVIDIA, FuriosaAI RNGD, Rebellions Atom+).

## Pilot Kubernetes Install

Deploys MLPerf CNN/DM + MMLU-Pro into a fresh namespace (`kcloud-mlperf`) with a single command.
Only required input: the node IP list.

```bash
./scripts/install_pilot_k8s.sh --node-ips "10.254.202.81,10.254.202.82,10.254.202.83"
```

Device mode, storage class, HF token, and registry are all auto-detected.
Dry-run and validate-only modes are available before any cluster mutation:

```bash
# Read-only preflight — verify cluster is ready
./scripts/install_pilot_k8s.sh --node-ips "..." --validate-only

# Render + dry-run — print plan, no apply
./scripts/install_pilot_k8s.sh --node-ips "..." --dry-run
```

See **[docs/pilot_k8s_installation.md](docs/pilot_k8s_installation.md)** for the full reference:
prerequisites, auto-detection behavior, HF token handling, GPU/NPU/CPU fallback, all flags, cleanup, and troubleshooting.

## Full-Stack Install

Deploys the **entire ETRI LLM evaluation platform** — storage, device operators, observability,
web application (frontend + backend), and benchmark layer — from a single command.
Only required input: the cluster node IP list.

```bash
./scripts/install_kcloud_stack.sh --node-ips "10.254.202.81,10.254.202.82,10.254.202.83"
```

Stages run in order: `storage → operators → observability → webapp → benchmarks → verify`.
Everything is auto-detected (device mode, NFS server, access IP, HF token); supply override
flags only for non-default topology.

Safe-by-default modes (no cluster mutation):

```bash
# Read-only preflight — verify cluster is ready for full-stack install
./scripts/install_kcloud_stack.sh --node-ips "..." --validate-only

# Render + dry-run — print plan, no apply
./scripts/install_kcloud_stack.sh --node-ips "..." --dry-run
```

Access URLs after install:

| Service | URL |
|---|---|
| Frontend | `http://<access-ip>:30001` |
| Backend API | `http://<access-ip>:30980/api` |

For kind-based confidence-loop testing (no real hardware required):

```bash
test/run_confidence_loop.sh 3    # 3 iterations: kind_up → install → kind_down
```

See **[docs/full_stack_installation.md](docs/full_stack_installation.md)** for the complete reference:
stage breakdown, auto-detect vs. override table, bare-node provisioning, storage/NFS selection,
HF token and imagePullSecret handling, GPU/NPU/CPU fallback, verification, kind testing workflow,
cleanup, and troubleshooting.

## Repository Layout

```
scripts/                  Installer entrypoint + lib (install_pilot_k8s.sh, lib/)
deploy/templates/         Kubernetes manifest templates (envsubst-rendered at install time)
benchmarks/               Benchmark Python scripts and profiles
jobs/                     Reference Job manifests (existing workloads)
infra/                    Infrastructure scripts
docs/                     End-user documentation
```

## Supported Accelerators

| Mode | Resource | Notes |
|---|---|---|
| `gpu` | `nvidia.com/gpu` | NVIDIA L40 / A40 via GPU Operator |
| `npu-rngd` | `furiosa.ai/rngd` | FuriosaAI RNGD; thin-client benchmark mode |
| `npu-atom` | `rebellions.ai/ATOM` | Rebellions Atom+; device plugin currently parked |
| `cpu` | — | Fallback; no accelerator required |

Default selection priority: `gpu > npu-rngd > npu-atom > cpu`.
