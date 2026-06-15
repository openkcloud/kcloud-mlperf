"""TT100T smoke benchmark for Rebellions Atom+ NPU.

Generates 100 output tokens repeatedly with optimum-rbln compiled model and
records timing statistics. Outputs results as JSON to /results/<RUN_ID>/atomplus/tt100t/.
"""
import json
import os
import statistics
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

RUN_ID = os.environ.get("RUN_ID", datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S"))
MODEL_ID = os.environ.get("MODEL_ID", "Qwen/Qwen2.5-0.5B-Instruct")
OUTPUT_TOKENS = int(os.environ.get("OUTPUT_TOKENS", "100"))
WARMUP_RUNS = int(os.environ.get("WARMUP_RUNS", "3"))
MEASURED_RUNS = int(os.environ.get("MEASURED_RUNS", "10"))
PROMPT = os.environ.get("PROMPT", "Explain how a transformer model generates text, step by step.")
OUTPUT_DIR = Path(os.environ.get("OUTPUT_DIR", f"/results/{RUN_ID}/atomplus/tt100t"))
COMPILE_DIR = Path(os.environ.get("COMPILE_DIR", "/cache/rbln-compiled"))

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
COMPILE_DIR.mkdir(parents=True, exist_ok=True)

def log(msg):
    print(f"[{datetime.now(timezone.utc).isoformat()}] {msg}", flush=True)

def main():
    log(f"RUN_ID={RUN_ID}")
    log(f"MODEL_ID={MODEL_ID}")
    log(f"OUTPUT_TOKENS={OUTPUT_TOKENS}")
    log(f"WARMUP_RUNS={WARMUP_RUNS}, MEASURED_RUNS={MEASURED_RUNS}")
    log(f"OUTPUT_DIR={OUTPUT_DIR}")

    import rebel
    log(f"rebel.device_count()={rebel.device_count()}")

    from optimum.rbln import RBLNAutoModelForCausalLM
    from transformers import AutoTokenizer

    cached = COMPILE_DIR / MODEL_ID.replace("/", "__")
    log(f"Compile cache target: {cached}")

    if cached.exists() and any(cached.iterdir()):
        log("Loading pre-compiled RBLN model from cache")
        model = RBLNAutoModelForCausalLM.from_pretrained(str(cached))
    else:
        log("Compiling model with optimum-rbln (first run; will be cached)")
        compile_start = time.perf_counter()
        model = RBLNAutoModelForCausalLM.from_pretrained(
            MODEL_ID,
            export=True,
            rbln_batch_size=1,
            rbln_max_seq_len=1024,
            rbln_tensor_parallel_size=1,
        )
        compile_end = time.perf_counter()
        log(f"Compile time: {compile_end - compile_start:.1f}s")
        cached.mkdir(parents=True, exist_ok=True)
        model.save_pretrained(str(cached))

    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    inputs = tokenizer(PROMPT, return_tensors="pt", padding=True)
    log(f"Prompt tokens: {inputs.input_ids.shape}")

    raw_path = OUTPUT_DIR / "tt100t_raw.jsonl"
    summary_path = OUTPUT_DIR / "tt100t_summary.json"

    def one_run(label):
        t0 = time.perf_counter()
        out = model.generate(
            inputs.input_ids,
            max_new_tokens=OUTPUT_TOKENS,
            min_new_tokens=OUTPUT_TOKENS,
            do_sample=False,
        )
        t1 = time.perf_counter()
        gen_tokens = out.shape[-1] - inputs.input_ids.shape[-1]
        return {
            "label": label,
            "elapsed_s": t1 - t0,
            "output_tokens": int(gen_tokens),
            "tokens_per_second": gen_tokens / (t1 - t0) if (t1 - t0) > 0 else 0,
        }

    log("=== Warmup ===")
    for i in range(WARMUP_RUNS):
        r = one_run(f"warmup-{i+1}")
        log(f"  warmup-{i+1}: {r['elapsed_s']:.3f}s, {r['output_tokens']} tok, {r['tokens_per_second']:.2f} tok/s")

    log("=== Measured ===")
    measured = []
    with raw_path.open("w") as f:
        for i in range(MEASURED_RUNS):
            r = one_run(f"measured-{i+1}")
            r["timestamp"] = datetime.now(timezone.utc).isoformat()
            measured.append(r)
            f.write(json.dumps(r) + "\n")
            log(f"  measured-{i+1}: {r['elapsed_s']:.3f}s, {r['output_tokens']} tok, {r['tokens_per_second']:.2f} tok/s")

    times = [r["elapsed_s"] for r in measured]
    valid = [r for r in measured if r["output_tokens"] >= OUTPUT_TOKENS]
    invalid_count = len(measured) - len(valid)

    if not valid:
        verdict = "INVALID"
    else:
        valid_times = [r["elapsed_s"] for r in valid]
        valid_times_sorted = sorted(valid_times)
        mean_s = statistics.mean(valid_times)
        verdict = "PASS" if mean_s < 1.1 else "FAIL"

    summary = {
        "run_id": RUN_ID,
        "model_id": MODEL_ID,
        "output_tokens_target": OUTPUT_TOKENS,
        "warmup_runs": WARMUP_RUNS,
        "measured_runs": MEASURED_RUNS,
        "invalid_runs": invalid_count,
        "verdict": verdict,
        "stats_seconds": {
            "min": min(times) if times else None,
            "max": max(times) if times else None,
            "mean": statistics.mean(times) if times else None,
            "stddev": statistics.pstdev(times) if len(times) > 1 else 0.0,
            "p50": sorted(times)[len(times)//2] if times else None,
            "p90": sorted(times)[int(len(times)*0.9)] if times else None,
            "p95": sorted(times)[int(len(times)*0.95)] if times else None,
            "p99": sorted(times)[int(len(times)*0.99)] if times else None,
        },
        "tt100t_target_seconds": 1.1,
        "completed_at": datetime.now(timezone.utc).isoformat(),
    }

    with summary_path.open("w") as f:
        json.dump(summary, f, indent=2)

    log("=== SUMMARY ===")
    log(json.dumps(summary, indent=2))
    log(f"verdict: {verdict}")
    log(f"raw: {raw_path}")
    log(f"summary: {summary_path}")
    return 0 if verdict in ("PASS", "FAIL") else 1


if __name__ == "__main__":
    sys.exit(main())
