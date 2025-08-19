import argparse
import json
import math
import os
import re
import shutil
import sys
import time
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


# Lazy imports for heavy deps to keep CLI responsive for --help
def _lazy_imports_for_inference():
    global torch, datasets, evaluate, vllm, SamplingParams
    import torch  # type: ignore
    from datasets import load_dataset  # type: ignore
    import evaluate as _evaluate  # type: ignore
    from vllm import LLM, SamplingParams  # type: ignore

    # Re-export for local usage
    globals()["datasets"] = load_dataset
    globals()["evaluate"] = _evaluate
    globals()["vllm"] = LLM


@dataclass
class SystemInfo:
    gpu_count: int
    gpus: List[str]
    cuda: Optional[str]
    torch_version: Optional[str]
    transformers_version: Optional[str]
    vllm_version: Optional[str]
    driver_version: Optional[str]


def detect_system_info() -> SystemInfo:
    gpus: List[str] = []
    driver_version: Optional[str] = None
    cuda_version: Optional[str] = None
    torch_version: Optional[str] = None
    transformers_version: Optional[str] = None
    vllm_version: Optional[str] = None

    try:
        import torch as _torch  # type: ignore
        torch_version = getattr(_torch, "__version__", None)
        if _torch.cuda.is_available():
            cuda_version = getattr(_torch.version, "cuda", None)
            try:
                for d in range(_torch.cuda.device_count()):
                    gpus.append(_torch.cuda.get_device_name(d))
            except Exception:
                pass
        else:
            cuda_version = None
    except Exception:
        pass

    try:
        import transformers as _transformers  # type: ignore
        transformers_version = getattr(_transformers, "__version__", None)
    except Exception:
        pass

    try:
        import vllm as _vllm  # type: ignore
        vllm_version = getattr(_vllm, "__version__", None)
    except Exception:
        pass

    # nvidia-smi info if available
    try:
        import subprocess

        out = subprocess.run(
            ["nvidia-smi", "-L"], capture_output=True, text=True, check=False
        ).stdout.strip()
        if out:
            gpus = [line.strip() for line in out.splitlines() if line.strip()]
        drv = subprocess.run(
            [
                "bash",
                "-lc",
                "nvidia-smi --query-gpu=driver_version --format=csv,noheader | head -n1",
            ],
            capture_output=True,
            text=True,
            check=False,
        ).stdout.strip()
        if drv:
            driver_version = drv
    except Exception:
        pass

    gpu_count = len(gpus)
    return SystemInfo(
        gpu_count=gpu_count,
        gpus=gpus,
        cuda=cuda_version,
        torch_version=torch_version,
        transformers_version=transformers_version,
        vllm_version=vllm_version,
        driver_version=driver_version,
    )


def map_model_alias(alias: str) -> str:
    canon = alias.strip().lower()
    if canon in {"llama3.1-8b-instruct", "llama-3.1-8b-instruct", "llama31-8b", "llama3.1"}:
        return "meta-llama/Llama-3.1-8B-Instruct"
    # Pass-through for full HF IDs
    return alias


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def update_latest_symlink(results_dir: Path, run_dir: Path) -> None:
    latest = results_dir / "latest"
    if latest.is_symlink() or latest.exists():
        try:
            if latest.is_dir() and not latest.is_symlink():
                shutil.rmtree(latest)
            else:
                latest.unlink()
        except Exception:
            pass
    try:
        latest.symlink_to(run_dir.name, target_is_directory=True)
    except Exception:
        # Fallback: absolute symlink if relative fails
        try:
            latest.symlink_to(run_dir, target_is_directory=True)
        except Exception:
            # As a last resort, copy a marker file
            with open(results_dir / "LATEST_RUN.txt", "w", encoding="utf-8") as f:
                f.write(str(run_dir))


def purge_old_runs(results_dir: Path, keep_all: bool, keep_name: str) -> None:
    if keep_all:
        return
    if not results_dir.exists():
        return
    entries = [p for p in results_dir.iterdir() if p.is_dir() and p.name != "latest"]
    # Keep only the specified run directory; remove others with YYYYMMDD-hhmmss naming
    for p in entries:
        if p.name == keep_name:
            continue
        # Only delete timestamp-like directories to be safe
        if re.match(r"^\d{8}-\d{6}$", p.name):
            shutil.rmtree(p, ignore_errors=True)


def timestamp() -> str:
    return datetime.now().strftime("%Y%m%d-%H%M%S")


def default_sample_count(category: str) -> int:
    return 13368 if category == "datacenter" else 5000


def write_text_file(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


def write_json_file(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def resolve_tensor_parallel(tp: str, sysinfo: SystemInfo) -> int:
    if tp == "auto":
        return max(1, sysinfo.gpu_count)
    try:
        return max(1, int(tp))
    except Exception:
        return 1


def resolve_precision_dtype(precision: str) -> str:
    precision = precision.lower()
    if precision == "fp16":
        return "float16"
    if precision == "bf16":
        return "bfloat16"
    return "auto"


def load_cnndm_validation(total_count: int) -> Tuple[List[str], List[str]]:
    # Returns (prompts, references)
    ds = datasets("cnn_dailymail", "3.0.0", split="validation")
    # Build prompts compatible with instruction-tuned summarization
    prompts: List[str] = []
    refs: List[str] = []
    for item in ds:
        article = item["article"].strip()
        highlight = item["highlights"].strip()
        prompt = (
            "Summarize the following news article in one concise paragraph.\n\n"
            f"Article:\n{article}\n\nSummary:"
        )
        prompts.append(prompt)
        refs.append(highlight)
        if len(prompts) >= total_count:
            break
    return prompts, refs


def choose_total_count(category: str, override: Optional[str]) -> int:
    if override is None or override == "auto":
        return default_sample_count(category)
    try:
        val = int(override)
        return max(1, val)
    except Exception:
        return default_sample_count(category)


def read_meta(results_dir: Path) -> Dict[str, Any]:
    meta_file = results_dir / "meta.json"
    if meta_file.exists():
        try:
            with open(meta_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}


def write_meta(results_dir: Path, meta: Dict[str, Any]) -> None:
    write_json_file(results_dir / "meta.json", meta)


def auto_server_qps(results_dir: Path, measured_offline_tps: Optional[float]) -> float:
    # Prefer provided measured value; otherwise consult meta.json
    if measured_offline_tps and measured_offline_tps > 0:
        return max(0.1, 0.8 * measured_offline_tps)
    meta = read_meta(results_dir)
    last = meta.get("last_offline_tokens_per_sec")
    if isinstance(last, (int, float)) and last > 0:
        return max(0.1, 0.8 * float(last))
    return 0.5


def build_sampling_params(max_new_tokens: int, deterministic: bool) -> Any:
    temperature = 0.0 if deterministic else 0.7
    top_p = 1.0 if deterministic else 0.95
    top_k = 1 if deterministic else 50
    return SamplingParams(
        max_tokens=max_new_tokens,
        temperature=temperature,
        top_p=top_p,
        top_k=top_k,
        seed=42 if deterministic else None,
    )


def generate_with_vllm(
    model_id: str,
    precision_dtype: str,
    tensor_parallel: int,
    prompts: List[str],
    sampling_params: Any,
    max_model_len: int,
    gpu_memory_utilization: float,
) -> Tuple[List[str], List[int]]:
    llm = vllm(
        model=model_id,
        tensor_parallel_size=tensor_parallel,
        dtype=precision_dtype,
        trust_remote_code=True,
        max_model_len=max_model_len,
        gpu_memory_utilization=gpu_memory_utilization,
    )
    outputs = llm.generate(prompts, sampling_params)
    texts: List[str] = []
    new_token_counts: List[int] = []
    for out in outputs:
        if not out.outputs:
            texts.append("")
            new_token_counts.append(0)
            continue
        best = out.outputs[0]
        texts.append(best.text)
        try:
            new_token_counts.append(len(best.token_ids))
        except Exception:
            new_token_counts.append(len(best.text.split()))
    return texts, new_token_counts


def compute_rouge(preds: List[str], refs: List[str]) -> Dict[str, float]:
    rouge = evaluate.load("rouge")
    scores = rouge.compute(predictions=preds, references=refs, use_stemmer=True)
    # Normalize keys
    return {
        "rouge1": float(scores.get("rouge1", 0.0)),
        "rouge2": float(scores.get("rouge2", 0.0)),
        "rougeL": float(scores.get("rougeL", 0.0)),
        "rougeLsum": float(scores.get("rougeLsum", 0.0)),
    }


def percentile(values: List[float], p: float) -> float:
    if not values:
        return 0.0
    values_sorted = sorted(values)
    k = (len(values_sorted) - 1) * p
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return values_sorted[int(k)]
    d0 = values_sorted[f] * (c - k)
    d1 = values_sorted[c] * (k - f)
    return d0 + d1


def write_performance_logs(
    perf_dir: Path,
    scenario: str,
    duration_s: float,
    total_new_tokens: int,
    per_sample_lat_ms: List[float],
) -> None:
    tokens_per_sec = (total_new_tokens / duration_s) if duration_s > 0 else 0.0
    summary_lines = [
        f"scenario={scenario}",
        f"duration_ms={int(duration_s * 1000)}",
        f"total_new_tokens={total_new_tokens}",
        f"tokens_per_sec={tokens_per_sec:.4f}",
        f"num_samples={len(per_sample_lat_ms)}",
        f"p50_ms={percentile(per_sample_lat_ms, 0.50):.3f}",
        f"p90_ms={percentile(per_sample_lat_ms, 0.90):.3f}",
        f"p95_ms={percentile(per_sample_lat_ms, 0.95):.3f}",
        f"p99_ms={percentile(per_sample_lat_ms, 0.99):.3f}",
    ]
    write_text_file(perf_dir / "mlperf_log_summary.txt", "\n".join(summary_lines) + "\n")

    detail_lines = []
    for idx, lat in enumerate(per_sample_lat_ms):
        detail_lines.append(f"sample_id={idx}, latency_ms={lat:.3f}")
    write_text_file(perf_dir / "mlperf_log_detail.txt", "\n".join(detail_lines) + "\n")


def run_accuracy(
    args: argparse.Namespace,
    run_dir: Path,
    sysinfo: SystemInfo,
) -> Dict[str, Any]:
    accuracy_dir = run_dir / "Accuracy"
    ensure_dir(accuracy_dir)

    total_count = choose_total_count(args.category, args.total_sample_count)
    prompts, refs = load_cnndm_validation(total_count)

    sp = build_sampling_params(args.max_new_tokens, deterministic=True)
    preds, new_token_counts = generate_with_vllm(
        map_model_alias(args.model),
        resolve_precision_dtype(args.precision),
        resolve_tensor_parallel(args.tensor_parallel_size, sysinfo),
        prompts,
        sp,
        args.max_model_len,
        args.gpu_memory_utilization,
    )

    # Save accuracy log JSON similar in spirit to MLPerf accuracy
    acc_records = [
        {"sample_id": i, "candidate": preds[i]} for i in range(len(preds))
    ]
    write_json_file(accuracy_dir / "mlperf_log_accuracy.json", acc_records)

    rouge_scores = compute_rouge(preds, refs)
    write_json_file(accuracy_dir / "rouge.json", rouge_scores)

    # Gate: >= 0.99 or 0.999 in high-accuracy mode, using rougeLsum as primary
    gate = 0.999 if int(args.high_accuracy) == 1 else 0.99
    passed = float(rouge_scores.get("rougeLsum", 0.0)) >= gate

    return {
        "mode": "accuracy",
        "total_samples": total_count,
        "rouge": rouge_scores,
        "passed": passed,
        "new_tokens_sum": int(sum(new_token_counts)),
    }


def run_performance_offline(
    args: argparse.Namespace,
    run_dir: Path,
    sysinfo: SystemInfo,
) -> Dict[str, Any]:
    perf_dir = run_dir / "Performance"
    ensure_dir(perf_dir)

    total_count = choose_total_count(args.category, args.total_sample_count)
    prompts, _ = load_cnndm_validation(total_count)

    sp = build_sampling_params(args.max_new_tokens, deterministic=False)

    t0 = time.perf_counter()
    preds, new_token_counts = generate_with_vllm(
        map_model_alias(args.model),
        resolve_precision_dtype(args.precision),
        resolve_tensor_parallel(args.tensor_parallel_size, sysinfo),
        prompts,
        sp,
        args.max_model_len,
        args.gpu_memory_utilization,
    )
    t1 = time.perf_counter()

    # Approx per-sample latency as the mean latency (coarse, as vLLM batches internally)
    duration_s = t1 - t0
    per_sample_lat_ms: List[float] = [
        (duration_s * 1000.0) / max(1, len(preds))
    ] * len(preds)
    total_new_tokens = int(sum(new_token_counts))
    write_performance_logs(perf_dir, "offline", duration_s, total_new_tokens, per_sample_lat_ms)

    tokens_per_sec = (total_new_tokens / duration_s) if duration_s > 0 else 0.0

    # Update meta.json for server auto target
    meta = read_meta(run_dir.parent)
    meta["last_offline_tokens_per_sec"] = tokens_per_sec
    write_meta(run_dir.parent, meta)

    return {
        "mode": "performance",
        "scenario": "offline",
        "total_samples": total_count,
        "duration_s": duration_s,
        "total_new_tokens": total_new_tokens,
        "tokens_per_sec": tokens_per_sec,
    }


def run_performance_server(
    args: argparse.Namespace,
    run_dir: Path,
    sysinfo: SystemInfo,
) -> Dict[str, Any]:
    perf_dir = run_dir / "Performance"
    ensure_dir(perf_dir)

    total_count = choose_total_count(args.category, args.total_sample_count)
    prompts, _ = load_cnndm_validation(total_count)

    # Determine target QPS
    target_qps: float
    if isinstance(args.server_target_qps, str) and args.server_target_qps == "auto":
        target_qps = auto_server_qps(run_dir.parent, measured_offline_tps=None)
    else:
        try:
            target_qps = max(0.1, float(args.server_target_qps))
        except Exception:
            target_qps = 0.5

    sp = build_sampling_params(args.max_new_tokens, deterministic=False)

    # Simple rate-limited loop issuing single requests; measures per-query latency
    interval_s = 1.0 / target_qps
    latencies_ms: List[float] = []
    tokens_emitted = 0

    model_id = map_model_alias(args.model)
    precision_dtype = resolve_precision_dtype(args.precision)
    tensor_parallel = resolve_tensor_parallel(args.tensor_parallel_size, sysinfo)
    llm = vllm(
        model=model_id,
        tensor_parallel_size=tensor_parallel,
        dtype=precision_dtype,
        trust_remote_code=True,
        max_model_len=args.max_model_len,
        gpu_memory_utilization=args.gpu_memory_utilization,
    )

    start_time = time.perf_counter()
    next_issue_time = start_time
    for i, prompt in enumerate(prompts):
        now = time.perf_counter()
        if now < next_issue_time:
            time.sleep(max(0.0, next_issue_time - now))
        t0 = time.perf_counter()
        out = llm.generate([prompt], sp)
        t1 = time.perf_counter()
        latency_ms = (t1 - t0) * 1000.0
        latencies_ms.append(latency_ms)
        try:
            if out and out[0].outputs:
                tokens_emitted += len(out[0].outputs[0].token_ids)
        except Exception:
            pass
        next_issue_time = max(next_issue_time + interval_s, t1)

    total_duration_s = time.perf_counter() - start_time
    achieved_qps = len(prompts) / total_duration_s if total_duration_s > 0 else 0.0

    write_performance_logs(perf_dir, "server", total_duration_s, tokens_emitted, latencies_ms)

    return {
        "mode": "performance",
        "scenario": "server",
        "total_samples": total_count,
        "duration_s": total_duration_s,
        "tokens_emitted": tokens_emitted,
        "achieved_qps": achieved_qps,
        "target_qps": target_qps,
        "latency_ms": {
            "p50": percentile(latencies_ms, 0.50),
            "p90": percentile(latencies_ms, 0.90),
            "p95": percentile(latencies_ms, 0.95),
            "p99": percentile(latencies_ms, 0.99),
        },
    }


def run_performance_singlestream(
    args: argparse.Namespace,
    run_dir: Path,
    sysinfo: SystemInfo,
) -> Dict[str, Any]:
    perf_dir = run_dir / "Performance"
    ensure_dir(perf_dir)

    total_count = choose_total_count(args.category, args.total_sample_count)
    prompts, _ = load_cnndm_validation(total_count)

    sp = build_sampling_params(args.max_new_tokens, deterministic=False)

    model_id = map_model_alias(args.model)
    precision_dtype = resolve_precision_dtype(args.precision)
    tensor_parallel = resolve_tensor_parallel(args.tensor_parallel_size, sysinfo)
    llm = vllm(
        model=model_id,
        tensor_parallel_size=tensor_parallel,
        dtype=precision_dtype,
        trust_remote_code=True,
        max_model_len=args.max_model_len,
        gpu_memory_utilization=args.gpu_memory_utilization,
    )

    latencies_ms: List[float] = []
    tokens_emitted = 0
    t0 = time.perf_counter()
    for prompt in prompts:
        s = time.perf_counter()
        out = llm.generate([prompt], sp)
        e = time.perf_counter()
        latencies_ms.append((e - s) * 1000.0)
        try:
            if out and out[0].outputs:
                tokens_emitted += len(out[0].outputs[0].token_ids)
        except Exception:
            pass
    duration_s = time.perf_counter() - t0

    write_performance_logs(perf_dir, "singlestream", duration_s, tokens_emitted, latencies_ms)

    return {
        "mode": "performance",
        "scenario": "singlestream",
        "total_samples": total_count,
        "duration_s": duration_s,
        "tokens_emitted": tokens_emitted,
        "latency_ms": {
            "p50": percentile(latencies_ms, 0.50),
            "p90": percentile(latencies_ms, 0.90),
            "p95": percentile(latencies_ms, 0.95),
            "p99": percentile(latencies_ms, 0.99),
        },
    }


def build_and_write_report(
    run_dir: Path,
    args: argparse.Namespace,
    sysinfo: SystemInfo,
    run_outcome: Dict[str, Any],
) -> None:
    # Defer heavy import to avoid circular
    from report import build_summary_and_report

    summary, report_md = build_summary_and_report(
        run_dir=run_dir,
        args_dict={k: (v if not isinstance(v, Path) else str(v)) for k, v in vars(args).items()},
        sysinfo=asdict(sysinfo),
        run_outcome=run_outcome,
    )
    write_json_file(run_dir / "summary.json", summary)
    write_text_file(run_dir / "report.md", report_md)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="MLPerf LLaMA-3.1-8B Runner (Clean Slate) — vLLM backend",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--version", default="5.1")
    parser.add_argument("--model", default="llama3.1-8b-instruct")
    parser.add_argument("--backend", default="vllm")
    parser.add_argument("--category", choices=["datacenter", "edge"], required=True)
    parser.add_argument(
        "--scenario",
        choices=["offline", "server", "singlestream"],
        required=True,
    )
    parser.add_argument("--mode", choices=["accuracy", "performance"], required=True)
    parser.add_argument("--precision", choices=["fp16", "bf16"], default="fp16")
    parser.add_argument("--tensor-parallel-size", default="auto")
    parser.add_argument("--max-new-tokens", type=int, default=128)
    parser.add_argument("--total-sample-count", default="auto")
    parser.add_argument("--server-target-qps", default="auto")
    parser.add_argument("--dataset", choices=["cnndm"], default="cnndm")
    parser.add_argument("--results-dir", default="./results")
    parser.add_argument("--keep-all", type=int, choices=[0, 1], default=0)
    parser.add_argument("--high-accuracy", type=int, choices=[0, 1], default=0)
    parser.add_argument("--max-model-len", dest="max_model_len", type=int, default=8192)
    parser.add_argument("--gpu-memory-utilization", type=float, default=0.90)

    args = parser.parse_args()

    if args.backend != "vllm":
        print("Only vLLM backend is supported in this clean-slate runner.")
        sys.exit(2)

    if args.category == "datacenter" and args.scenario not in {"offline", "server"}:
        print("Datacenter supports: offline, server")
        sys.exit(2)
    if args.category == "edge" and args.scenario not in {"offline", "singlestream"}:
        print("Edge supports: offline, singlestream")
        sys.exit(2)

    # Heavy deps
    _lazy_imports_for_inference()

    # Results structure
    results_dir = Path(args.results_dir).resolve()
    run_id = timestamp()
    run_dir = results_dir / run_id
    ensure_dir(run_dir)
    ensure_dir(results_dir)

    # Purge and update symlink
    purge_old_runs(results_dir, bool(args.keep_all), keep_name=run_id)
    update_latest_symlink(results_dir, run_dir)

    # System info and config
    sysinfo = detect_system_info()
    config = {
        "args": {k: (v if not isinstance(v, Path) else str(v)) for k, v in vars(args).items()},
        "system": asdict(sysinfo),
        "env": {k: os.environ.get(k, "") for k in ["HF_TOKEN", "HUGGINGFACE_HUB_TOKEN"]},
        "start_time": datetime.now().isoformat(),
    }
    write_json_file(run_dir / "config.json", config)

    run_outcome: Dict[str, Any]

    if args.mode == "accuracy":
        run_outcome = run_accuracy(args, run_dir, sysinfo)
        if not run_outcome.get("passed", False):
            print("Accuracy gate failed (ROUGE-Lsum). See Accuracy/rouge.json for details.")
            # Still write report for visibility
            build_and_write_report(run_dir, args, sysinfo, run_outcome)
            sys.exit(1)
        build_and_write_report(run_dir, args, sysinfo, run_outcome)
        print("Accuracy run completed and passed.")
        return

    # Performance
    if args.scenario == "offline":
        run_outcome = run_performance_offline(args, run_dir, sysinfo)
    elif args.scenario == "server":
        run_outcome = run_performance_server(args, run_dir, sysinfo)
    else:
        run_outcome = run_performance_singlestream(args, run_dir, sysinfo)

    build_and_write_report(run_dir, args, sysinfo, run_outcome)
    print("Performance run completed.")


if __name__ == "__main__":
    main()


