import argparse
import json
import os
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Tuple


def _lazy_imports():
    global datasets, vllm, SamplingParams
    from datasets import load_dataset  # type: ignore
    from vllm import LLM, SamplingParams  # type: ignore
    globals()["datasets"] = load_dataset
    globals()["vllm"] = LLM


def map_model_alias(alias: str) -> str:
    canon = alias.strip().lower()
    if canon in {"llama3.1-8b-instruct", "llama-3.1-8b-instruct", "llama31-8b", "llama3.1"}:
        return "meta-llama/Llama-3.1-8B-Instruct"
    return alias


DOMAINS = {
    "abstract_algebra": "STEM",
    "anatomy": "STEM",
    "astronomy": "STEM",
    "college_biology": "STEM",
    "college_chemistry": "STEM",
    "college_computer_science": "STEM",
    "college_mathematics": "STEM",
    "college_physics": "STEM",
    "computer_security": "STEM",
    "conceptual_physics": "STEM",
    "electrical_engineering": "STEM",
    "elementary_mathematics": "STEM",
    "high_school_biology": "STEM",
    "high_school_chemistry": "STEM",
    "high_school_computer_science": "STEM",
    "high_school_mathematics": "STEM",
    "high_school_physics": "STEM",
    "high_school_statistics": "STEM",
    "machine_learning": "STEM",
    "humanities": "Humanities",  # umbrella if needed
    # Social sciences & other mapping for common tasks
}


def map_task_to_domain(task: str) -> str:
    # Simplified mapping; default to Other
    for k, v in DOMAINS.items():
        if task.startswith(k):
            return v
    if "history" in task or "philosophy" in task or "law" in task:
        return "Humanities"
    if "econom" in task or "geograph" in task or "politic" in task or "psychology" in task:
        return "Social Sciences"
    return "Other"


def build_prompt(question: str, choices: List[str]) -> str:
    options = "\n".join([f"{chr(65+i)}. {c}" for i, c in enumerate(choices)])
    return (
        "You are a helpful assistant. Answer the multiple-choice question by outputting only the letter.\n\n"
        f"Question: {question}\n\n"
        f"Choices:\n{options}\n\n"
        "Answer:"
    )


def evaluate_mmlu(model_id: str, batch_size: int, max_new_tokens: int, total_limit: int | None) -> Tuple[Dict[str, float], Dict[str, float]]:
    tasks = [
        # A light subset if total_limit is small; otherwise datasets will include all
        "mmlu",
    ]
    ds = datasets("cais/mmlu", "all", split="test")

    llm = vllm(model=model_id, tensor_parallel_size=int(os.environ.get("GPU_COUNT", "1")), dtype="float16", trust_remote_code=True)
    sp = SamplingParams(max_tokens=max_new_tokens, temperature=0.0, top_p=1.0, top_k=1, seed=42)

    total = 0
    correct = 0
    by_domain_total: Counter[str] = Counter()
    by_domain_correct: Counter[str] = Counter()

    prompts: List[str] = []
    answers: List[str] = []
    domains: List[str] = []

    for ex in ds:
        if total_limit is not None and total >= total_limit:
            break
        q = ex["question"]
        choices = [ex["choices"][i] for i in range(4)]
        ans = ex["answer"]  # index 0..3
        prompt = build_prompt(q, choices)
        prompts.append(prompt)
        answers.append(chr(65 + int(ans)))
        domains.append(map_task_to_domain(ex.get("subject", "")))
        total += 1
        if len(prompts) == batch_size:
            outs = llm.generate(prompts, sp)
            for i, out in enumerate(outs):
                text = out.outputs[0].text.strip() if out.outputs else ""
                pred = text[:1].upper() if text else ""
                if pred == answers[i]:
                    correct += 1
                    by_domain_correct[domains[i]] += 1
                by_domain_total[domains[i]] += 1
            prompts, answers, domains = [], [], []

    # flush
    if prompts:
        outs = llm.generate(prompts, sp)
        for i, out in enumerate(outs):
            text = out.outputs[0].text.strip() if out.outputs else ""
            pred = text[:1].upper() if text else ""
            if pred == answers[i]:
                correct += 1
                by_domain_correct[domains[i]] += 1
            by_domain_total[domains[i]] += 1

    overall = {"overall_accuracy": (correct / max(1, sum(by_domain_total.values()))) if by_domain_total else 0.0}
    by_domain = {}
    for d in sorted(by_domain_total.keys()):
        by_domain[d] = by_domain_correct[d] / max(1, by_domain_total[d])
    return overall, by_domain


def main() -> None:
    parser = argparse.ArgumentParser(description="MMLU Evaluator (vLLM)")
    parser.add_argument("--model", default="llama3.1-8b-instruct")
    parser.add_argument("--backend", default="vllm")
    parser.add_argument("--batch-size", default="auto")
    parser.add_argument("--max-new-tokens", type=int, default=1)
    parser.add_argument("--results-dir", default="./results/mmlu")
    parser.add_argument("--total-limit", type=int, default=None)
    args = parser.parse_args()

    if args.backend != "vllm":
        raise SystemExit("Only vLLM backend is supported")

    _lazy_imports()
    results_root = Path(args.results_dir).resolve()
    run_dir = results_root / datetime.now().strftime("%Y%m%d-%H%M%S")
    run_dir.mkdir(parents=True, exist_ok=True)

    model_id = map_model_alias(args.model)
    batch_size = os.cpu_count() or 8
    if isinstance(args.batch_size, str) and args.batch_size == "auto":
        bs = max(4, batch_size // 2)
    else:
        try:
            bs = max(1, int(args.batch_size))
        except Exception:
            bs = 8

    overall, by_domain = evaluate_mmlu(model_id, bs, args.max_new_tokens, args.total_limit)
    (run_dir / "overall.json").write_text(json.dumps(overall, indent=2))
    (run_dir / "by_domain.json").write_text(json.dumps(by_domain, indent=2))

    # simple markdown report
    lines = ["# MMLU Report", "", f"Model: {model_id}", ""]
    lines.append("## Overall")
    lines.append(f"Accuracy: {overall['overall_accuracy']:.4f}")
    lines.append("")
    lines.append("## By Domain")
    for d, acc in sorted(by_domain.items()):
        lines.append(f"- {d}: {acc:.4f}")
    (run_dir / "report.md").write_text("\n".join(lines) + "\n")

    print(f"Wrote MMLU results to {run_dir}")


if __name__ == "__main__":
    main()


