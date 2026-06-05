#!/usr/bin/env python3
"""Recompile Llama-3.1-8B-Instruct for Rebellions Atom+ (RBLN-CA22) with
rebel-compiler 0.10.3, tensor_parallel_size=2 (both cards).

Run on node5 after staging source weights to /home/kcloud/models/Llama-3.1-8B-Instruct
(see RECOMPILE_SERVE_0103.md). Produces ~19 GB at OUT in ~3.5 min.
"""
import time
from optimum.rbln import RBLNLlamaForCausalLM

SRC = "/home/kcloud/models/Llama-3.1-8B-Instruct"
OUT = "/home/kcloud/cache/rbln-compiled/Llama-3.1-8B-Instruct-1003-tp2"

t0 = time.time()
print(f"[compile] start tp2 max_seq_len=8192 batch=1 src={SRC}", flush=True)


def do(**kw):
    return RBLNLlamaForCausalLM.from_pretrained(SRC, export=True, **kw)


try:
    # optimum-rbln 0.10.3: tensor_parallel_size is a base-config key.
    m = do(rbln_config={"tensor_parallel_size": 2, "max_seq_len": 8192, "batch_size": 1})
except TypeError as e:
    print(f"[compile] rbln_config dict rejected ({e}); trying flattened kwargs", flush=True)
    m = do(rbln_tensor_parallel_size=2, rbln_max_seq_len=8192, rbln_batch_size=1)

m.save_pretrained(OUT)
try:
    from transformers import AutoTokenizer
    AutoTokenizer.from_pretrained(SRC).save_pretrained(OUT)
except Exception as e:  # noqa: BLE001
    print(f"[compile] tokenizer save warn: {e}", flush=True)
print(f"[compile] COMPILE_DONE {OUT} in {round(time.time()-t0)}s", flush=True)
