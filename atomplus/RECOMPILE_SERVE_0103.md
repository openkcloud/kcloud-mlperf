# Atom+ (Rebellions) inference bring-up — SDK 0.10.3 / driver 3.0.0

**Status: LIVE on node5 (2026-06-05).** Reproduces the host-served vLLM-RBLN
OpenAI endpoint the backend's npu-eval ATOM path calls at
`http://10.254.202.111:30093`. Atom+ is **host-served, not k8s-scheduled**
(there is no official Rebellions k8s device plugin), so this runs as a systemd
unit on node5 — not as a pod.

## Context / why a recompile was needed
The lab upgraded node5 to **Rebellions driver 3.0.0 / SDK 0.10.3 /
rebel-compiler 0.10.3** (i-cloud, 2026-06-04). The previous compiled artifact
(`/home/kcloud/cache/rbln-compiled/__mnt__models__Llama-3.1-8B-Instruct`, built
May-6 with rebel-compiler **0.9.3**) then failed to load with
`RuntimeError: LOADING_INVALID_VERSION`. An 8B model at fp16 (~16 GB) also
exceeds a single Atom+ card's 15.7 GB, so **tensor_parallel_size=2 (both cards)
is required** — which doubles as the NPU "multi-device" integration.

## Procedure (all on node5 = 10.254.202.111, user kcloud)

### 1. Stage source weights (ungated mirror == meta-llama weights)
`meta-llama/Llama-3.1-8B-Instruct` is gated and no HF token is provisioned, so
use the byte-identical ungated mirror. node5 has internet egress.
```python
# /home/kcloud/dl_weights.py
from huggingface_hub import snapshot_download
snapshot_download("NousResearch/Meta-Llama-3.1-8B-Instruct",
    local_dir="/home/kcloud/models/Llama-3.1-8B-Instruct",
    allow_patterns=["*.safetensors","*.json","*.txt","tokenizer*","*.model"])
```

### 2. Recompile with rebel-compiler 0.10.3, TP=2 (see `compile_rbln.py`)
```python
from optimum.rbln import RBLNLlamaForCausalLM
m = RBLNLlamaForCausalLM.from_pretrained(
    "/home/kcloud/models/Llama-3.1-8B-Instruct", export=True,
    rbln_config={"tensor_parallel_size": 2, "max_seq_len": 8192, "batch_size": 1})
m.save_pretrained("/home/kcloud/cache/rbln-compiled/Llama-3.1-8B-Instruct-1003-tp2")
```
Compile takes ~3.5 min and writes ~19 GB (prefill.rbln + decoder_batch_1.rbln +
rbln_config.json with `optimum_rbln_version: 0.10.3`, `tensor_parallel_size: 2`).
Confirm the NPUs are free first (`rbln-smi`).

### 3. Serve as a durable systemd unit on :30093
`/etc/systemd/system/atomplus-vllm.service` (User=kcloud):
```ini
[Unit]
Description=ETRI Atom+ vLLM-RBLN OpenAI server (Llama-3.1-8B-Instruct tp2, SDK 0.10.3) on :30093
After=network-online.target rbln-default-rsd.service
Wants=network-online.target
[Service]
Type=simple
User=kcloud
WorkingDirectory=/home/kcloud
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Environment=VLLM_RBLN_TP_SIZE=2
ExecStart=/usr/local/bin/vllm serve /home/kcloud/cache/rbln-compiled/Llama-3.1-8B-Instruct-1003-tp2 --served-model-name rebellions/Llama-3.1-8B-Instruct Llama-3.1-8B-Instruct meta-llama/Llama-3.1-8B-Instruct --max-num-seqs 1 --max-num-batched-tokens 8192 --max-model-len 8192 --block-size 8192 --port 30093 --host 0.0.0.0
Restart=always
RestartSec=10
TimeoutStartSec=300
[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload && sudo systemctl enable --now atomplus-vllm.service
```
`--served-model-name` lists aliases so the server tolerates every historical
Atom+ `model` string the backend may send (`rebellions/Llama-3.1-8B-Instruct`
is canonical). `VLLM_RBLN_TP_SIZE=2` is required because pre-compiled rbln
models reject `--tensor-parallel-size`.

### 4. Verify
```bash
curl http://127.0.0.1:30093/health            # 200
curl http://127.0.0.1:30093/v1/models         # lists rebellions/Llama-3.1-8B-Instruct
curl http://127.0.0.1:30093/v1/chat/completions -H 'Content-Type: application/json' \
  -d '{"model":"rebellions/Llama-3.1-8B-Instruct","messages":[{"role":"user","content":"Say OK"}],"max_tokens":5}'
```
End-to-end backend → exam (npu-eval, npu_type="Atom+", precision FP16): exam 184
mlperf = **26.98 tps / TT100T 3.74 s / 60.4 W** (first valid Atom+ run on 0.10.3).

## Gotchas
- The `rebellions` user's `rvp-rbln-backend.service` (`/home/rebellions/kcloud-rvp`,
  a Tenstorrent/RVP research project) crash-loops on its own `ModuleNotFoundError:
  control_plane` — **unrelated to ETRI serving**; leave it alone. It crashes before
  opening the NPUs, so it does not contend for the cards.
- Backend pod → `10.254.202.111:30093` works over the Calico underlay (verified).
- Atom+ is FP16-only on this platform (`validateDevicePrecision`).
