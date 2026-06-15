# Atom+ Self-Service Benchmark Runbook (no vendor contact required)

**Audience**: cluster admin running benchmarks on node5 Rebellions Atom+ NPUs without depending on Rebellions support, the private wheelhouse, or the `drivercred` Docker pull secret.

**Pre-requisites already met as of RUN_ID 20260429-071649-46d82f8**:

- containerd CDI enabled on node5
- `rbln-npu-operator v0.3.3` deployed in `rbln-system`
- `rebellions.ai/ATOM: 2` advertised in node5 allocatable resources
- node5 uncordoned
- node5 host has `rbln-sdk 0.10.1`, `rebel-compiler 0.9.3.post1`, `optimum-rbln 0.9.3.post1`, `vllm 0.10.2`, `vllm_rbln 0.9.3.post2`, `transformers 4.57.1`, `torch 2.8.0` already pip-installed at `/usr/local/lib/python3.10/dist-packages/`

---

## Path A — Host-mode benchmark (5 min total, **0 dependencies on private images**)

This is the path that produced runs id=67 and id=68 in production. It runs Python directly on node5's host interpreter, bypassing K8s and bypassing the need for any container image.

### A.1 — One-time per node5: copy the smoke script

```bash
# From node1
scp /home/kcloud/build-rbln-smoke/tt100t_smoke.py kcloud@10.254.202.111:/tmp/tt100t_smoke.py
```

The script is also persisted at `/home/kcloud/etri-llm-exam-solution/build-rbln-smoke/tt100t_smoke.py` in this repo (mirror copy in `scripts/qa/atomplus_qa.js` is the QA harness, not the smoke script).

### A.2 — Run a TT100T benchmark

```bash
# Pick any open HuggingFace model that optimum-rbln supports. Tested:
#   Qwen/Qwen2.5-0.5B-Instruct  (single NPU, ~70s compile, sub-second TT100T)
#   Qwen/Qwen2.5-7B-Instruct    (TP=2, ~7 min compile, ~3.7s TT100T)

RUN_ID=$(date -u +%Y%m%d-%H%M%S)
MODEL=Qwen/Qwen2.5-0.5B-Instruct  # or Qwen/Qwen2.5-7B-Instruct etc.

ssh kcloud@10.254.202.111 "RUN_ID=$RUN_ID \
  MODEL_ID='$MODEL' \
  OUTPUT_TOKENS=100 \
  WARMUP_RUNS=2 \
  MEASURED_RUNS=5 \
  OUTPUT_DIR=/home/kcloud/results/$RUN_ID/atomplus/tt100t \
  COMPILE_DIR=/home/kcloud/cache/rbln-compiled \
  HF_HOME=/home/kcloud/cache/hf-home \
  python3 /tmp/tt100t_smoke.py"

# Result files appear at node5:/home/kcloud/results/$RUN_ID/atomplus/tt100t/{tt100t_raw.jsonl, tt100t_summary.json}
```

For a TP=2 (both NPUs) run, edit the script's `rbln_tensor_parallel_size=1` to `=2` before running, OR pass it as an env var (the script can be extended in 2 lines).

### A.3 — Ingest results into the production DB

```bash
# Pull results back to node1
mkdir -p /home/kcloud/etri-llm-exam-solution/results/$RUN_ID/atomplus/tt100t
scp -r kcloud@10.254.202.111:/home/kcloud/results/$RUN_ID/atomplus/tt100t/* \
  /home/kcloud/etri-llm-exam-solution/results/$RUN_ID/atomplus/tt100t/

# Insert exam row
EXAM_ID=$(kubectl exec -n llm-evaluation deploy/etri-llm-db -- psql -U postgres -d llmEvaluationDB -t -A -c "
INSERT INTO npu_exam (
  name, description, benchmark, model, precision, framework,
  batch_size, dataset, data_number, npu_type, npu_num, max_output_tokens,
  status, started_at, end_at, retry_num
) VALUES (
  'ATOMPLUS-${MODEL//\//_}-TT100T-$RUN_ID',
  'Atom+ TT100T host-mode smoke',
  'tt100t', '$MODEL', 'BF16', 'optimum-rbln',
  1, 'CNN-DailyMail', 5, 'ATOM+', 1, 100,
  'Completed', NOW()::text, NOW()::text, 1
) RETURNING id;
")

# Insert per-run result rows (one per measured run, from tt100t_raw.jsonl)
python3 -c "
import json
with open('/home/kcloud/etri-llm-exam-solution/results/$RUN_ID/atomplus/tt100t/tt100t_raw.jsonl') as f:
    rows = [json.loads(l) for l in f]
print('INSERT INTO npu_exam_result (exam_id, result_number, result_tt100t, result_tps, result_latency, result_valid) VALUES')
print(',\n'.join(
    f\"($EXAM_ID, {i+1}, {r['elapsed_s']}, {r['tokens_per_second']}, {r['elapsed_s']}, 'TRUE')\"
    for i, r in enumerate(rows)
) + ';')
" > /tmp/insert.sql
kubectl exec -n llm-evaluation -i deploy/etri-llm-db -- psql -U postgres -d llmEvaluationDB < /tmp/insert.sql
```

After ingestion, the run is immediately visible at:
- `http://10.254.177.41:30980/api/comparison/list?hardware=npu`
- `http://10.254.177.41:30001/npu-eval/device-comparison` (in the run picker)
- (after frontend v21 deploy) `http://10.254.177.41:30001/npu-eval/atomplus`

---

## Path B — K8s-mode benchmark (no private image required, via host-package bind-mount)

This pattern lets a stock `python:3.10-slim` pod use node5's already-installed Rebellions Python wheels by bind-mounting them from the host. No `rebel-compiler` PyPI access needed.

### B.1 — One-time: write the manifest

```bash
cat > /tmp/atomplus-tt100t-bindmount-job.yaml <<'YAML'
apiVersion: batch/v1
kind: Job
metadata:
  name: atomplus-tt100t-bindmount-${RUN_ID}
  namespace: llm-evaluation
spec:
  backoffLimit: 0
  ttlSecondsAfterFinished: 86400
  template:
    spec:
      restartPolicy: Never
      nodeSelector:
        npu-vendor: rebellions
        npu-model: atomplus
      containers:
      - name: tt100t-runner
        image: python:3.10-slim
        env:
        - { name: RUN_ID, value: "${RUN_ID}" }
        - { name: MODEL_ID, value: "${MODEL_ID}" }
        - { name: OUTPUT_TOKENS, value: "100" }
        - { name: WARMUP_RUNS, value: "2" }
        - { name: MEASURED_RUNS, value: "5" }
        - { name: OUTPUT_DIR, value: "/results/${RUN_ID}/atomplus/tt100t" }
        - { name: COMPILE_DIR, value: "/cache/rbln-compiled" }
        - { name: HF_HOME, value: "/cache/hf-home" }
        # Make the host-installed wheels visible to the container's Python:
        - { name: PYTHONPATH, value: "/host-py-packages" }
        - { name: PATH, value: "/host-bin:/usr/local/bin:/usr/bin:/bin" }
        command: ["python3", "/script/tt100t_smoke.py"]
        securityContext:
          privileged: true   # required because bind-mounted host paths include /dev/rbln* and ld.so caches
        resources:
          requests:
            rebellions.ai/ATOM: "${NUM_NPUS}"
            cpu: "4"
            memory: 16Gi
          limits:
            rebellions.ai/ATOM: "${NUM_NPUS}"
            cpu: "8"
            memory: 32Gi
        volumeMounts:
        - { name: host-py-packages, mountPath: /host-py-packages, readOnly: true }
        - { name: host-bin,         mountPath: /host-bin,         readOnly: true }
        - { name: script,           mountPath: /script }
        - { name: results,          mountPath: /results }
        - { name: cache,            mountPath: /cache }
      volumes:
      - { name: host-py-packages, hostPath: { path: /usr/local/lib/python3.10/dist-packages, type: Directory } }
      - { name: host-bin,         hostPath: { path: /usr/local/bin, type: Directory } }
      - name: script
        configMap: { name: atomplus-tt100t-script }
      - { name: results, persistentVolumeClaim: { claimName: results-nfs-pvc } }
      - { name: cache,   persistentVolumeClaim: { claimName: model-nfs-pvc } }
YAML
```

### B.2 — Apply

```bash
RUN_ID=$(date -u +%Y%m%d-%H%M%S)
MODEL_ID=Qwen/Qwen2.5-0.5B-Instruct
NUM_NPUS=1

# Make the smoke script available as a ConfigMap (idempotent)
kubectl create configmap atomplus-tt100t-script -n llm-evaluation \
  --from-file=tt100t_smoke.py=/home/kcloud/build-rbln-smoke/tt100t_smoke.py \
  --dry-run=client -o yaml | kubectl apply -f -

# Render and apply the Job
RUN_ID=$RUN_ID MODEL_ID=$MODEL_ID NUM_NPUS=$NUM_NPUS envsubst < /tmp/atomplus-tt100t-bindmount-job.yaml | kubectl apply -f -

# Monitor
kubectl logs -n llm-evaluation -f -l job-name=atomplus-tt100t-bindmount-$RUN_ID
```

### B.3 — Caveats

- **`securityContext.privileged: true`** is required because the host-bind wheels include `.so` files that the container's loader needs to access via `LD_LIBRARY_PATH` / `ld.so.cache`. If you prefer to avoid privileged, write a custom image that copies the wheels in (see Path C).
- **Python interpreter version must match** — the host installs are under `python3.10`, so the container must also be `python:3.10-slim` (or `python:3.10`).
- **First-run model compilation** (~70 s for 0.5B, ~7 min for 7B) is cached at `/cache/rbln-compiled/` (PVC), so subsequent runs of the same model skip compile.

---

## Path C — Build a portable container image (one-time, ~15 min)

If you want a fully self-contained image that doesn't bind-mount the host, you can build one by tarring the host wheels.

```bash
# Copy host wheels off node5
ssh kcloud@10.254.202.111 'tar czf /tmp/rbln-wheels.tgz \
  -C /usr/local/lib/python3.10/dist-packages \
  rebel rebel_compiler-0.9.3.post1.dist-info \
  optimum optimum_rbln-0.9.3.post1.dist-info \
  vllm vllm-0.10.2.dist-info \
  vllm_rbln vllm_rbln-0.9.3.post2.dist-info'
scp kcloud@10.254.202.111:/tmp/rbln-wheels.tgz /home/kcloud/build-rbln-smoke/

# Append to the Dockerfile (after the public pip install layer):
cat >> /home/kcloud/build-rbln-smoke/Dockerfile <<'EOF'
COPY rbln-wheels.tgz /tmp/
RUN tar xzf /tmp/rbln-wheels.tgz -C /usr/local/lib/python3.10/site-packages/ && rm /tmp/rbln-wheels.tgz
EOF

# Build via kaniko (using the existing kaniko Job pattern)
# ... (see existing kaniko Job manifest at infra/k8s/.../kaniko-rbln-smoke-build)
```

This produces a portable `jungwooshim/etri-llm-rbln-smoke:vN` that runs anywhere the kernel module (host driver) is loaded.

---

## Path D — Larger-model benchmarking checklist

To get to "real" production benchmarks comparable to RNGD's Llama-3.1-8B-FP8 baseline, you'll want:

1. **HuggingFace token** with `meta-llama/Llama-3.1-8B-Instruct` access. Save it as a K8s secret:
   ```bash
   kubectl create secret generic huggingface-token -n llm-evaluation \
     --from-literal=HF_TOKEN=<your-token>
   ```
   The Job template at `infra/k8s/benchmark-jobs/atomplus-tt100t-job.yaml.template` already references this secret pattern.

2. **FP8 quantization** for fair comparison vs RNGD. `optimum-rbln` supports W8A8 quantization; configure via `RBLNQuantizationConfig` at compile time. See `https://docs.rbln.ai/software/optimum/optimum_rbln.html`. **No vendor support call required** — it's a parameter on `from_pretrained(...)`. Expected speedup: ~2× from BF16, which would put Atom+ TT100T on Llama-3.1-8B FP8 in the 1.5–2.0 s range — still slower than RNGD's 1.26 s, but roughly half the BF16 baseline.

3. **MLPerf inference performance scenarios** — vendor's own MLPerf submissions live at `https://mlcommons.org/benchmarks/inference-datacenter/` if available. For an internal/non-compliant TT100T+throughput suite, the existing `tt100t_smoke.py` is sufficient. For a real MLPerf compliance attempt, you'd integrate `mlperf_inference` LoadGen with vllm-rbln.

4. **MMLU / MMLU-Pro accuracy** — purely Python, no NPU-specific glue. Use `lm-evaluation-harness` with the vllm-rbln backend:
   ```bash
   ssh kcloud@10.254.202.111 'pip install lm-eval; \
     lm_eval --model vllm --model_args pretrained=Qwen/Qwen2.5-0.5B-Instruct,dtype=bfloat16 \
       --tasks mmlu --batch_size 1 --device rbln'
   ```

---

## Verification cheat-sheet

```bash
# Cluster
kubectl get node node5 -o jsonpath='{.status.allocatable.rebellions\.ai/ATOM}'   # → 2
kubectl get pods -n rbln-system                                                   # rbln-device-plugin Running on node5
kubectl describe node node5 | grep Taints                                         # no unschedulable taint

# Smoke pod (proves CDI injection)
kubectl run rbln-probe --rm -it --restart=Never \
  --image=ubuntu:22.04 --overrides='{"spec":{"nodeSelector":{"npu-vendor":"rebellions"},"containers":[{"name":"probe","image":"ubuntu:22.04","command":["ls","/dev/"],"resources":{"requests":{"rebellions.ai/ATOM":"1"},"limits":{"rebellions.ai/ATOM":"1"}}}]}}'
# expected: rbln0 or rbln1 visible in /dev/

# API
curl -s "http://10.254.177.41:30980/api/comparison/list?hardware=npu" | \
  python3 -c "import json,sys; d=json.load(sys.stdin); print(len([r for r in d['data']['runs'] if r.get('hardware',{}).get('vendor')=='rebellions']), 'rebellions runs')"

# Recent host-mode benchmark log
ssh kcloud@10.254.202.111 'ls -lt /home/kcloud/results/*/atomplus/tt100t/tt100t_summary.json | head -3'
```

## Rollback

```bash
helm uninstall rbln-npu-operator -n rbln-system
kubectl delete namespace rbln-system
ssh kcloud@10.254.202.111 'sudo cp /etc/containerd/config.toml.bak.20260429-071649 /etc/containerd/config.toml && sudo systemctl restart containerd'
kubectl cordon node5
```
