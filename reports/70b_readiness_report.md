# 70B Model Readiness Report

## Memory Math

### 70B FP8 Weights and KV Cache

**Per-device allocation with Tensor Parallelism (TP=4):**
- Weights: 70 GB ÷ 4 = 17.5 GB per device
- KV cache (at max_seq_len=2048, batch=1): ~1 GB per device
- Activation memory (during inference): ~0.5–1 GB per device
- **Total per device: ~19–20 GB**

**Device capacity comparison:**
| Device | Capacity | 70B FP8 + KV | Headroom | Verdict |
|--------|----------|--------------|----------|---------|
| L40 | 48 GB | 20 GB | 28 GB (58%) | MARGINAL — acceptable but limited batch size |
| A40 | 48 GB | 20 GB | 28 GB (58%) | MARGINAL — same as L40 |
| A100-80G | 80 GB | 20 GB | 60 GB (75%) | COMFORTABLE — room for large batches |
| RNGD | 24 GB | 20 GB | 4 GB (17%) | TIGHT — single-token batch only |
| Atom+ | 12 GB | — | — | INSUFFICIENT — cannot fit 70B FP8 |

### 70B BF16 (Not Recommended)

**Per-device with TP=4:**
- Weights: 140 GB ÷ 4 = 35 GB per device
- KV cache: ~2 GB per device
- Activation memory: ~1 GB per device
- **Total per device: ~38 GB**

**Only A100-80G (80 GB) can accommodate this**, and just barely. L40, A40, and RNGD are all insufficient. **BF16 70B is not viable for this cluster without additional A100-80G nodes.**

## Current Cluster Hardware Inventory

**Data from config/cluster.yaml and Kubernetes node status (as of 2026-04-28):**

### Active Nodes (Joined)
| Node | Role | Accelerator | Model | Count | Capacity | Status |
|------|------|-------------|-------|-------|----------|--------|
| node1 | master | CPU | Intel | — | — | Ready |
| node2 | worker | GPU | L40 + A40 | 2 | 48+48 GB | Ready |
| node3 | worker | GPU | L40-44 + A40-44 | 2 | 44+44 GB | Ready |
| node4 | worker | NPU | RNGD | 1 | 24 GB | Ready |
| **Total** | — | — | — | **5 devices** | **~210 GB** | — |

### Pending Nodes (Not Yet Joined)
| Node | Role | Accelerator | Model | Count | Capacity | Status |
|------|------|-------------|-------|-------|----------|--------|
| node5 | worker | NPU | Atom+ | 2 | 12+12 GB | pending_join (see config/cluster.yaml) |

### Hardware Fit Verdict

**For 70B FP8 with TP=4:**

1. **Using 4 L40 devices** (node2.device[0,1], node3.device[0,1]):
   - Total capacity: 4 × 48 GB = 192 GB
   - 70B FP8 allocation: 4 × 20 GB = 80 GB
   - Headroom per device: 28 GB
   - **Verdict: MARGINAL** ✓ Fits, but tight. Batch size limited to 1–2 tokens; high-concurrency scenarios may OOM.

2. **Using 4 A100-80G devices** (if available in future):
   - Total capacity: 4 × 80 GB = 320 GB
   - 70B FP8 allocation: 4 × 20 GB = 80 GB
   - Headroom per device: 60 GB
   - **Verdict: COMFORTABLE** ✓ Excellent fit. Batch sizes up to 32 tokens or multi-user concurrent requests.

3. **Using 4 RNGD devices** (Furiosa NPU):
   - Current: 1 RNGD on node4 (24 GB)
   - 70B FP8 allocation: 4 × 20 GB = 80 GB
   - **Verdict: BLOCKED** ✗ Only 1 RNGD in cluster. Need +3 RNGDs.

## Required Hardware Additions

To enable 70B FP8 deployment, choose one path:

### Path A: Add 3 RNGD Devices (Furiosa NPU)
**Cost-effective but vendor-specific:**
- Purchase: 3 × Furiosa RNGD (or compatible Furiosa accelerator)
- Install on node5 or new node6 (requires physical space, PCIe slots)
- Update config/cluster.yaml with device entries
- Result: 4 RNGD devices (node4 + node5) enable 70B FP8 with TP=4

### Path B: Add 3 A100-80G Devices (NVIDIA GPU)
**More flexible but higher cost:**
- Purchase: 3 × NVIDIA A100-80GB GPU
- Install on node6 (or upgrade node2/node3 if slots available)
- Update config/cluster.yaml and NVIDIA GPU operator helm values
- Result: A100-80G cluster becomes the primary compute target for 70B FP8

### Path C: Accept Marginal Performance (Current)
**No hardware purchase; use existing L40s:**
- Deploy 70B FP8 on node2 and node3 (4 L40 devices total)
- Constrain batch size to 1–2 tokens, disable concurrent requests
- Latency will be higher due to memory contention
- Not recommended for production benchmarks; acceptable for research/POC only

## Failure Mode Detection

**Scripts must detect insufficient hardware and fail gracefully:**

All benchmark scripts (scripts/11_run_mlperf_performance.sh, scripts/13_run_mmlu_pro.sh, etc.) that attempt to deploy 70B must:

1. **Pre-flight check**: Query cluster for available devices matching model requirements
   ```bash
   # Pseudocode
   REQUIRED_DEVICES=4
   AVAILABLE_DEVICES=$(kubectl get nodes -l npu-vendor=furiosa --no-headers | wc -l)
   if [ "$AVAILABLE_DEVICES" -lt "$REQUIRED_DEVICES" ]; then
     echo "ERROR: Insufficient hardware. Need $REQUIRED_DEVICES NPUs, have $AVAILABLE_DEVICES."
     exit 78  # EX_CONFIG — indicates configuration error
   fi
   ```

2. **Exit with code 78** (EX_CONFIG per sysexits.h) if hardware is insufficient
   - This signals to orchestrators (e.g., runners, CI/CD) that the failure is NOT transient
   - CI/CD should NOT retry; instead, alert the operator

3. **Error message format**:
   ```
   FATAL: Insufficient hardware for 70B FP8 deployment.
   Required: 4 NPU devices (RNGD) or 4 GPU devices (A100-80G)
   Current cluster:
     - RNGD: 1 device (node4)
     - A100-80G: 0 devices
   Action: Contact ops to add hardware or select a smaller model (e.g., 8B FP8).
   ```

4. **No fallback, no faked results**:
   - Do NOT proceed with the benchmark
   - Do NOT downgrade to a smaller model automatically
   - Do NOT emit partial or fake data
   - Fail fast and loudly

## Cross-Node Tensor Parallelism Risk

**70B FP8 with TP=4 requires communication between 4 devices.** If those devices span multiple nodes, inter-node network latency becomes critical.

**Current cluster network:**
- Control plane (node1) to workers (node2–5): Likely 10–25 Gbps ethernet
- Intra-node (e.g., within node2): PCIe bus, minimal latency
- Inter-node (e.g., between node2 and node3): Switch + cable, ~100–1000μs latency

**Risk assessment for 70B FP8 on current cluster:**

| Scenario | Latency Impact | TPS Impact | Verdict |
|----------|---|---|---|
| TP=4 on node2 L40s (same node) | <1 μs | negligible | GOOD — intra-node only |
| TP=4 across node2+node3 L40s | 100–1000 μs | ~5–10% reduction | ACCEPTABLE — brief stalls between all-reduce |
| TP=4 across node2+node3+node4+node5 | 100+ μs + hops | ~10–20% reduction | RISKY — many hops; monitor closely |

**Mitigations:**
1. **Prefer intra-node TP** (pin 4 devices on a single node)
   - For current cluster: not possible (max 2 GPUs per node)
   - Future: consider node with 4 GPU slots, or purchase 4-device NPU clusters
2. **Use async communication** (some frameworks like vLLM batch all-reduces)
3. **Profile latency** before benchmarking:
   ```bash
   python -c "import torch.distributed; torch.distributed.init_process_group('nccl')"
   # Then measure NCCL bandwidth across device pairs
   ```

## Summary: Go/No-Go for 70B

| Configuration | Ready? | Blocker | Timeline |
|---|---|---|---|
| **70B FP8 on existing L40s** | ❌ MARGINAL | Batch size < 2; high memory contention | Research only; not for production |
| **70B FP8 on RNGDs** | ❌ NO | Missing 3 RNGD devices | 2–4 weeks (hardware procurement + install) |
| **70B FP8 on A100-80G** | ❌ NO | Missing 3 A100-80G devices | 2–4 weeks (hardware + setup) |
| **70B BF16** | ❌ NO | Missing A100-80G nodes entirely | Not recommended; use FP8 instead |
| **8B FP8 (current)** | ✅ YES | None | Active today |
| **8B BF16 (current)** | ✅ YES | None | Active today |

## Recommendation

**Do NOT plan for 70B production deployment until hardware is in hand and installed.** Current cluster is optimized for 8B models. If 70B is required:

1. **Decide on accelerator**: RNGD (cost-efficient) or A100-80G (flexible)?
2. **Procure 3 additional devices** and allocate 2–4 weeks for install + integration
3. **Update cluster.yaml and k8s device-plugin configs**
4. **Add 70B entries to config/model_profiles.yaml** (template provided above)
5. **Test TP=4 all-reduce latency** across the final hardware before benchmarking
6. **Implement pre-flight checks** in all benchmark scripts (exit code 78 on insufficient hardware)
7. **Re-run readiness assessment** once hardware is installed
