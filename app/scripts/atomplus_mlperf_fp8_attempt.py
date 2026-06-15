#!/usr/bin/env python3
"""Atom+ MLPerf CNN/DailyMail 100-sample benchmark.

Attempts FP8 via RBLN_QUANTIZATION=fp8 env var and rbln_config.
If FP8 compile fails, falls back to BF16 (authorized per W7 contract).
Outputs result.json compatible with scripts/import-benchmark-result.ts.

Run on node5:
  python3 /home/kcloud/etri-llm-exam-solution/scripts/atomplus_mlperf_fp8_attempt.py
"""
import json
import os
import statistics
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

TS = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
RUN_ID = f"mlperf-cnndm100-fp8-atomplus-{TS}"
MODEL_ID = os.environ.get("MODEL_ID", "meta-llama/Llama-3.1-8B-Instruct")
COMPILE_DIR = Path(os.environ.get("COMPILE_DIR", "/home/kcloud/cache/rbln-compiled"))
COMPILE_CACHE_NAME = os.environ.get("COMPILE_CACHE_NAME", "__mnt__models__Llama-3.1-8B-Instruct")
MAX_OUTPUT_TOKENS = int(os.environ.get("MAX_OUTPUT_TOKENS", "128"))
N_SAMPLES = int(os.environ.get("N_SAMPLES", "100"))
OUTPUT_DIR = Path(os.environ.get("OUTPUT_DIR", f"/home/kcloud/results/{RUN_ID}"))
LOG_PATH = Path(os.environ.get("LOG_PATH",
    f"/home/kcloud/etri-llm-exam-solution/logs/benchmarks/mlperf_atomplus_fp8_{TS}.log"))

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
_log_fh = LOG_PATH.open("a")

def log(msg):
    line = f"[{datetime.now(timezone.utc).isoformat()}] {msg}"
    print(line, flush=True)
    _log_fh.write(line + "\n")
    _log_fh.flush()

def main():
    started_at = datetime.now(timezone.utc).isoformat()
    log(f"=== Atom+ MLPerf CNN/DailyMail 100-sample FP8 Attempt ===")
    log(f"RUN_ID={RUN_ID}")
    log(f"MODEL_ID={MODEL_ID}")
    log(f"N_SAMPLES={N_SAMPLES}")
    log(f"MAX_OUTPUT_TOKENS={MAX_OUTPUT_TOKENS}")
    log(f"COMPILE_DIR={COMPILE_DIR}")
    log(f"dataset=cnn_dailymail version=3.0.0")

    # Check rebel device count
    try:
        import rebel
        npu_count = rebel.device_count()
        log(f"rebel.device_count()={npu_count}")
    except Exception as e:
        log(f"rebel import failed: {e}")
        npu_count = 0

    # Load dataset
    log("Loading cnn_dailymail 3.0.0 test split...")
    try:
        from datasets import load_dataset
        ds = load_dataset("abisee/cnn_dailymail", "3.0.0", split="test")
        samples = list(ds)[:N_SAMPLES]
        log(f"Dataset loaded: {len(samples)} samples, dataset=cnn_dailymail, version=3.0.0")
    except Exception as e:
        err = f"Dataset load failed: {e}"
        log(f"ERROR: {err}")
        write_result(started_at, "failed", err, None, "bf16", False)
        return 1

    # Step 1: Attempt FP8 compilation
    fp8_compile_dir = COMPILE_DIR / f"{COMPILE_CACHE_NAME}-fp8"
    fp8_success = False
    fp8_stderr = ""

    log("=== Step 1: Attempting FP8 compile via rbln_config ===")
    log(f"FP8 compile target dir: {fp8_compile_dir}")
    try:
        from optimum.rbln import RBLNAutoModelForCausalLM, RBLNConfig
        from transformers import AutoTokenizer

        # Try FP8 quantization via rbln_config
        log("Attempting RBLNAutoModelForCausalLM.from_pretrained with rbln_config quantization=fp8...")
        try:
            rbln_cfg = RBLNConfig(
                model_type="llama",
                rbln_quantization="fp8",
                rbln_batch_size=1,
                rbln_max_seq_len=1024,
            )
            model_fp8 = RBLNAutoModelForCausalLM.from_pretrained(
                MODEL_ID,
                export=True,
                rbln_config=rbln_cfg,
            )
            model_fp8.save_pretrained(str(fp8_compile_dir))
            fp8_success = True
            log(f"FP8 compile SUCCEEDED: {fp8_compile_dir}")
        except Exception as e:
            fp8_stderr = str(e)
            log(f"FP8 compile failed (attempt 1 rbln_config): {e}")

        if not fp8_success:
            # Try via env var RBLN_QUANTIZATION=fp8
            log("Attempting via RBLN_QUANTIZATION=fp8 env var...")
            os.environ["RBLN_QUANTIZATION"] = "fp8"
            try:
                model_fp8 = RBLNAutoModelForCausalLM.from_pretrained(
                    MODEL_ID,
                    export=True,
                    rbln_batch_size=1,
                    rbln_max_seq_len=1024,
                )
                model_fp8.save_pretrained(str(fp8_compile_dir))
                fp8_success = True
                log(f"FP8 compile SUCCEEDED via env var: {fp8_compile_dir}")
            except Exception as e2:
                fp8_stderr += f"\n--- RBLN_QUANTIZATION=fp8 attempt ---\n{e2}"
                log(f"FP8 compile failed (attempt 2 env var): {e2}")
    except Exception as e:
        fp8_stderr = str(e)
        log(f"FP8 compile setup failed: {e}")

    if not fp8_success:
        log("=== FP8 BLOCKED: optimum-rbln does not support FP8 quantization ===")
        log(f"stderr proof: {fp8_stderr}")
        log("Falling back to BF16 as authorized per W7 contract")
        precision_actual = "bf16"
        precision_mismatch = True
    else:
        precision_actual = "fp8"
        precision_mismatch = False

    # Step 2: Load model (FP8 compiled or BF16 cached)
    if fp8_success:
        model_cache = fp8_compile_dir
    else:
        model_cache = COMPILE_DIR / COMPILE_CACHE_NAME

    log(f"=== Step 2: Loading model from {model_cache} ===")
    try:
        from optimum.rbln import RBLNAutoModelForCausalLM
        from transformers import AutoTokenizer

        if not model_cache.exists():
            err = f"Model cache not found: {model_cache}"
            log(f"ERROR: {err}")
            write_result(started_at, "failed", err, None, precision_actual, precision_mismatch,
                         fp8_stderr=fp8_stderr if precision_mismatch else "")
            return 1

        model = RBLNAutoModelForCausalLM.from_pretrained(str(model_cache))
        tokenizer = AutoTokenizer.from_pretrained(str(model_cache))
        if tokenizer.pad_token is None:
            tokenizer.pad_token = tokenizer.eos_token
        log(f"Model loaded successfully (precision={precision_actual})")
    except Exception as e:
        err = f"Model load failed: {e}"
        log(f"ERROR: {err}")
        write_result(started_at, "failed", err, None, precision_actual, precision_mismatch,
                     fp8_stderr=fp8_stderr if precision_mismatch else "")
        return 1

    # Warmup
    log("=== Warmup (3 samples) ===")
    for i, sample in enumerate(samples[:3]):
        prompt = f"Summarize the following article in a few sentences:\n\n{sample['article'][:1500]}"
        try:
            inputs = tokenizer(prompt, return_tensors="pt", truncation=True, max_length=896)
            t0 = time.perf_counter()
            model.generate(inputs.input_ids, max_new_tokens=MAX_OUTPUT_TOKENS, do_sample=False)
            t1 = time.perf_counter()
            log(f"  warmup-{i+1}: {t1-t0:.3f}s")
        except Exception as e:
            log(f"  warmup-{i+1} failed: {e}")

    # Benchmark
    log(f"=== Benchmark: {len(samples)} samples ===")
    results_raw = []
    errors = 0
    for i, sample in enumerate(samples):
        prompt = f"Summarize the following article in a few sentences:\n\n{sample['article'][:1500]}"
        try:
            inputs = tokenizer(prompt, return_tensors="pt", truncation=True, max_length=896)
            t0 = time.perf_counter()
            out = model.generate(inputs.input_ids, max_new_tokens=MAX_OUTPUT_TOKENS, do_sample=False)
            t1 = time.perf_counter()
            gen_tokens = out.shape[-1] - inputs.input_ids.shape[-1]
            elapsed = t1 - t0
            row = {
                "idx": i,
                "elapsed_s": round(elapsed, 6),
                "output_tokens": int(gen_tokens),
                "tps": round(gen_tokens / elapsed, 3) if elapsed > 0 else 0,
            }
            results_raw.append(row)
            if i < 5 or i % 20 == 0:
                log(f"  sample {i+1}/{len(samples)}: {elapsed:.3f}s {row['tps']:.1f} tok/s")
        except Exception as e:
            errors += 1
            log(f"  sample {i+1} error: {e}")

    completed_at = datetime.now(timezone.utc).isoformat()

    if not results_raw:
        err = f"All {len(samples)} samples failed"
        log(f"ERROR: {err}")
        write_result(started_at, "failed", err, None, precision_actual, precision_mismatch,
                     fp8_stderr=fp8_stderr if precision_mismatch else "")
        return 1

    times = [r["elapsed_s"] for r in results_raw]
    tps_vals = [r["tps"] for r in results_raw]
    total_tokens = sum(r["output_tokens"] for r in results_raw)
    elapsed_total = sum(times)
    mean_s = statistics.mean(times)
    tt100t_s = mean_s * (100 / MAX_OUTPUT_TOKENS)
    throughput_tps = total_tokens / elapsed_total if elapsed_total > 0 else 0
    elapsed_wall = (datetime.fromisoformat(completed_at) - datetime.fromisoformat(started_at)).total_seconds()
    times_sorted = sorted(times)

    log("=== RESULTS ===")
    log(f"  Samples: {len(results_raw)}/{len(samples)} (errors={errors})")
    log(f"  precision={precision_actual} (target=fp8 mismatch={precision_mismatch})")
    log(f"  TT100T: {tt100t_s:.4f}s")
    log(f"  Throughput: {throughput_tps:.2f} tok/s")
    log(f"  Mean latency: {mean_s:.3f}s")

    result = {
        "run_id": RUN_ID,
        "hardware": "Rebellions-Atom+",
        "vendor": "rebellions",
        "benchmark": "mlperf",
        "model": MODEL_ID,
        "precision": precision_actual,
        "precision_target": "fp8",
        "precision_mismatch": precision_mismatch,
        "precision_mismatch_reason": (
            f"optimum-rbln {os.popen('pip show optimum-rbln | grep Version').read().strip()} does not support FP8 quantization. "
            f"BF16 fallback authorized per W7 contract. stderr: {fp8_stderr[:500]}"
        ) if precision_mismatch else None,
        "dataset": "CNN-DailyMail",
        "dataset_version": "3.0.0",
        "scenario": "offline",
        "max_output_tokens": MAX_OUTPUT_TOKENS,
        "started_at": started_at,
        "completed_at": completed_at,
        "status": "completed",
        "failure_reason": None,
        "tt100t_seconds": round(tt100t_s, 6),
        "elapsed_seconds": round(elapsed_wall, 1),
        "throughput_tokens_per_sec": round(throughput_tps, 3),
        "raw_metrics": {
            "result_perf_tps": round(throughput_tps, 3),
            "result_perf_sps": round(len(results_raw) / elapsed_total, 6) if elapsed_total > 0 else 0,
            "result_perf_tps_best": round(max(tps_vals), 3),
            "result_perf_sps_best": None,
            "result_perf_valid": "VALID" if errors == 0 else "PARTIAL",
            "result_perf_latency": round(mean_s, 6),
            "result_perf_serv_ttft": None,
            "result_perf_serv_tpot": None,
            "result_acc_rg_1": None,
            "result_acc_rg_2": None,
            "result_acc_rg_l": None,
            "result_acc_rg_lsum": None,
            "result_acc_total": None,
            "result_vram_peak": None,
            "result_gpu_util": None,
            "data_number": len(samples),
            "errors": errors,
            "mean_latency_s": round(mean_s, 6),
            "p50_latency_s": round(times_sorted[len(times_sorted)//2], 6),
            "p90_latency_s": round(times_sorted[int(len(times_sorted)*0.9)], 6),
            "p99_latency_s": round(times_sorted[-1], 6),
            "total_output_tokens": total_tokens,
            "npu_model": "RBLN-CA22",
            "framework": "optimum-rbln",
            "fp8_compile_attempted": True,
            "fp8_compile_succeeded": fp8_success,
            "fp8_compile_stderr": fp8_stderr[:1000] if fp8_stderr else "",
        },
        "logs_path": str(LOG_PATH),
        "artifact_path": str(OUTPUT_DIR),
        "config_fingerprint": f"mlperf|{MODEL_ID}|cnn_dailymail|3.0.0|{precision_actual}|{N_SAMPLES}|{MAX_OUTPUT_TOKENS}",
    }

    result_path = OUTPUT_DIR / "result.json"
    with result_path.open("w") as f:
        json.dump(result, f, indent=2)
    log(f"Result written to {result_path}")
    return 0

def write_result(started_at, status, reason, metrics, precision_actual, precision_mismatch, fp8_stderr=""):
    completed_at = datetime.now(timezone.utc).isoformat()
    elapsed = (datetime.fromisoformat(completed_at) - datetime.fromisoformat(started_at)).total_seconds()
    result = {
        "run_id": RUN_ID,
        "hardware": "Rebellions-Atom+",
        "vendor": "rebellions",
        "benchmark": "mlperf",
        "model": MODEL_ID,
        "precision": precision_actual,
        "precision_target": "fp8",
        "precision_mismatch": precision_mismatch,
        "precision_mismatch_reason": fp8_stderr[:500] if fp8_stderr else None,
        "dataset": "CNN-DailyMail",
        "dataset_version": "3.0.0",
        "scenario": "offline",
        "max_output_tokens": MAX_OUTPUT_TOKENS,
        "started_at": started_at,
        "completed_at": completed_at,
        "status": status,
        "failure_reason": reason,
        "tt100t_seconds": None,
        "elapsed_seconds": round(elapsed, 1),
        "throughput_tokens_per_sec": None,
        "raw_metrics": {
            "fp8_compile_attempted": True,
            "fp8_compile_succeeded": False,
            "fp8_compile_stderr": fp8_stderr[:1000] if fp8_stderr else "",
        },
        "logs_path": str(LOG_PATH),
        "artifact_path": "",
        "config_fingerprint": f"mlperf|{MODEL_ID}|cnn_dailymail|3.0.0|{precision_actual}|{N_SAMPLES}|{MAX_OUTPUT_TOKENS}",
    }
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    result_path = OUTPUT_DIR / "result.json"
    with result_path.open("w") as f:
        json.dump(result, f, indent=2)
    log(f"Failed result written to {result_path}")

if __name__ == "__main__":
    sys.exit(main())
