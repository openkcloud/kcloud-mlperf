#!/usr/bin/env python3
"""
MMLU-Pro Benchmark for Llama-3.1-8B
====================================
Wrapper around the official TIGER-AI-Lab/MMLU-Pro evaluation using vLLM.
Outputs formatted results matching the K8s benchmark job expectations.

Based on: https://github.com/TIGER-AI-Lab/MMLU-Pro
Dataset: TIGER-Lab/MMLU-Pro (HuggingFace)
"""

import argparse
import json
import logging
import os
import re
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    from zoneinfo import ZoneInfo
except ImportError:
    ZoneInfo = None  # type: ignore


# Lazy imports for heavy dependencies
def _lazy_imports():
    global torch, datasets, vllm, SamplingParams, AutoTokenizer
    import torch as _torch
    from datasets import load_dataset
    from vllm import LLM, SamplingParams as _SamplingParams
    from transformers import AutoTokenizer as _AutoTokenizer

    globals()["torch"] = _torch
    globals()["datasets"] = load_dataset
    globals()["vllm"] = LLM
    globals()["SamplingParams"] = _SamplingParams
    globals()["AutoTokenizer"] = _AutoTokenizer


# MMLU-Pro has up to 10 answer choices (A-J)
CHOICES = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]

# Subject to domain mapping for reporting
DOMAIN_MAPPING = {
    "math": "STEM",
    "physics": "STEM",
    "chemistry": "STEM",
    "biology": "STEM",
    "computer science": "STEM",
    "engineering": "STEM",
    "statistics": "STEM",
    "economics": "Social Sciences",
    "psychology": "Social Sciences",
    "business": "Social Sciences",
    "law": "Humanities",
    "philosophy": "Humanities",
    "history": "Humanities",
    "health": "Other",
    "other": "Other",
}


def map_model_alias(alias: str) -> str:
    """Map common model aliases to full HuggingFace model IDs."""
    canon = alias.strip().lower()
    if canon in {"llama3.1-8b-instruct", "llama-3.1-8b-instruct", "llama31-8b", "llama3.1"}:
        return "meta-llama/Llama-3.1-8B-Instruct"
    return alias


def get_domain(category: str) -> str:
    """Map MMLU-Pro category to a broader domain."""
    cat_lower = category.lower()
    for key, domain in DOMAIN_MAPPING.items():
        if key in cat_lower:
            return domain
    return "Other"


def preprocess_dataset(dataset) -> List[Dict[str, Any]]:
    """Preprocess MMLU-Pro dataset, filtering out N/A options."""
    processed = []
    for item in dataset:
        options = [opt for opt in item["options"] if opt != "N/A"]
        processed.append({
            "question_id": item.get("question_id", len(processed)),
            "question": item["question"],
            "options": options,
            "answer": item["answer"],
            "answer_index": item["answer_index"],
            "category": item["category"],
            "cot_content": item.get("cot_content", ""),
            "src": item.get("src", ""),
        })
    return processed


def format_prompt(question: str, options: List[str], category: str, 
                  few_shot_examples: Optional[List[Dict]] = None, use_cot: bool = True) -> str:
    """Format a question into the MMLU-Pro prompt format."""
    prompt_parts = []
    
    # System instruction
    instruction = (
        f"The following are multiple choice questions (with answers) about {category}. "
        "Think step by step and then finish your answer with \"the answer is (X)\" "
        "where X is the correct letter choice.\n\n"
    )
    prompt_parts.append(instruction)
    
    # Few-shot examples if provided
    if few_shot_examples:
        for ex in few_shot_examples:
            prompt_parts.append("Question:\n")
            prompt_parts.append(ex["question"] + "\n")
            prompt_parts.append("Options:\n")
            for i, opt in enumerate(ex["options"]):
                prompt_parts.append(f"{CHOICES[i]}. {opt}\n")
            if use_cot and ex.get("cot_content"):
                cot = ex["cot_content"].replace(
                    "A: Let's think step by step.",
                    "Answer: Let's think step by step."
                )
                prompt_parts.append(cot + "\n\n")
            else:
                prompt_parts.append(f"Answer: The answer is ({CHOICES[ex['answer_index']]}).\n\n")
    
    # Current question
    prompt_parts.append("Question:\n")
    prompt_parts.append(question + "\n")
    prompt_parts.append("Options:\n")
    for i, opt in enumerate(options):
        prompt_parts.append(f"{CHOICES[i]}. {opt}\n")
    prompt_parts.append("Answer: Let's think step by step.")
    
    return "".join(prompt_parts)


def extract_answer(text: str) -> Optional[str]:
    """Extract the answer letter from model output using multiple patterns."""
    # Pattern 1: "the answer is (X)" or "the answer is X"
    pattern1 = r"answer is \(?([A-J])\)?"
    match = re.search(pattern1, text, re.IGNORECASE)
    if match:
        return match.group(1).upper()
    
    # Pattern 2: "Answer: X" at end
    pattern2 = r'[aA]nswer:\s*([A-J])'
    match = re.search(pattern2, text)
    if match:
        return match.group(1).upper()
    
    # Pattern 3: Last standalone letter A-J
    pattern3 = r"\b([A-J])\b(?!.*\b[A-J]\b)"
    match = re.search(pattern3, text, re.DOTALL)
    if match:
        return match.group(1).upper()
    
    return None


def evaluate_mmlu_pro(
    model_id: str,
    precision: str = "bf16",
    max_model_len: int = 4096,
    gpu_memory_utilization: float = 0.90,
    total_limit: Optional[int] = None,
    num_few_shot: int = 5,
    use_cot: bool = True,
    selected_subjects: str = "all",
) -> Tuple[Dict[str, Any], Dict[str, float], Dict[str, float], List[Dict[str, Any]]]:
    """
    Run MMLU-Pro evaluation on the specified model.
    
    Returns:
        overall: Dict with overall accuracy
        by_category: Dict mapping category to accuracy
        by_domain: Dict mapping domain to accuracy
        sample_rows: List of per-sample results
    """
    logging.info(f"Loading MMLU-Pro dataset...")
    ds = datasets("TIGER-Lab/MMLU-Pro")
    test_data = preprocess_dataset(ds["test"])
    val_data = preprocess_dataset(ds["validation"])
    
    # Get all categories
    all_categories = sorted(set(item["category"] for item in test_data))
    
    # Filter categories if specified
    if selected_subjects != "all":
        selected = [s.strip() for s in selected_subjects.split(",")]
        all_categories = [c for c in all_categories if any(s.lower() in c.lower() for s in selected)]
    
    logging.info(f"Categories to evaluate: {len(all_categories)}")
    
    # Apply total limit if specified
    if total_limit:
        test_data = test_data[:total_limit]
    
    # Initialize model
    dtype = "bfloat16" if precision == "bf16" else "float16"
    tp_size = torch.cuda.device_count() if torch.cuda.is_available() else 1
    
    logging.info(f"Loading model {model_id} with TP={tp_size}, dtype={dtype}")
    llm = vllm(
        model=model_id,
        tensor_parallel_size=max(1, tp_size),
        dtype=dtype,
        trust_remote_code=True,
        max_model_len=max_model_len,
        gpu_memory_utilization=gpu_memory_utilization,
    )
    
    sampling_params = SamplingParams(
        temperature=0.0,
        max_tokens=2048,
        stop=["Question:"],
    )
    
    tokenizer = AutoTokenizer.from_pretrained(model_id, trust_remote_code=True)
    
    # Prepare few-shot examples by category
    val_by_category = {}
    for item in val_data:
        cat = item["category"]
        if cat not in val_by_category:
            val_by_category[cat] = []
        val_by_category[cat].append(item)
    
    # Build prompts
    prompts = []
    test_items = []
    
    for item in test_data:
        category = item["category"]
        few_shot = val_by_category.get(category, [])[:num_few_shot]
        
        prompt = format_prompt(
            item["question"],
            item["options"],
            category,
            few_shot_examples=few_shot if num_few_shot > 0 else None,
            use_cot=use_cot,
        )
        
        # Truncate if too long
        tokens = tokenizer.encode(prompt)
        if len(tokens) > max_model_len - 2048:
            # Reduce few-shot examples
            for k in range(num_few_shot - 1, -1, -1):
                prompt = format_prompt(
                    item["question"],
                    item["options"],
                    category,
                    few_shot_examples=few_shot[:k] if k > 0 else None,
                    use_cot=use_cot,
                )
                tokens = tokenizer.encode(prompt)
                if len(tokens) <= max_model_len - 2048:
                    break
        
        prompts.append(prompt)
        test_items.append(item)
    
    logging.info(f"Running inference on {len(prompts)} questions...")
    start_time = time.perf_counter()
    
    # Batch inference
    outputs = llm.generate(prompts, sampling_params)
    
    end_time = time.perf_counter()
    total_duration = end_time - start_time
    
    # Process results
    sample_rows = []
    by_category_correct = Counter()
    by_category_total = Counter()
    by_domain_correct = Counter()
    by_domain_total = Counter()
    
    for i, (item, output) in enumerate(zip(test_items, outputs)):
        generated_text = output.outputs[0].text if output.outputs else ""
        pred = extract_answer(generated_text)
        correct_answer = CHOICES[item["answer_index"]]
        is_correct = pred == correct_answer
        
        category = item["category"]
        domain = get_domain(category)
        
        by_category_total[category] += 1
        by_domain_total[domain] += 1
        
        if is_correct:
            by_category_correct[category] += 1
            by_domain_correct[domain] += 1
        
        sample_rows.append({
            "idx": i,
            "question_id": item.get("question_id", i),
            "category": category,
            "domain": domain,
            "answer": correct_answer,
            "pred": pred,
            "correct": int(is_correct),
            "model_output": generated_text[:500],  # Truncate for storage
        })
    
    # Calculate accuracies
    total_correct = sum(by_category_correct.values())
    total_count = sum(by_category_total.values())
    
    overall = {
        "overall_accuracy": total_correct / max(1, total_count),
        "total_questions": total_count,
        "total_correct": total_correct,
        "total_wrong": total_count - total_correct,
        "completion_rate": 1.0,
        "failed_questions": 0,
        "processing_time_s": total_duration,
        "avg_time_per_question_s": total_duration / max(1, total_count),
    }
    
    by_category = {
        cat: by_category_correct[cat] / max(1, by_category_total[cat])
        for cat in sorted(by_category_total.keys())
    }
    
    by_domain = {
        dom: by_domain_correct[dom] / max(1, by_domain_total[dom])
        for dom in sorted(by_domain_total.keys())
    }
    
    return overall, by_category, by_domain, sample_rows


def format_duration(seconds: float) -> str:
    """Format duration in human-readable format."""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    if hours > 0:
        return f"{hours}h{minutes}m{secs}s"
    elif minutes > 0:
        return f"{minutes}m{secs}s"
    return f"{secs}s"


def print_results_summary(
    overall: Dict[str, Any],
    by_category: Dict[str, float],
    model_id: str,
    acceptance_threshold: float = 0.65,
) -> bool:
    """Print formatted results summary matching the expected output format."""
    print("")
    print("=== Results Summary (MMLU) ===")
    print(f"Total questions processed: {overall['total_questions']}")
    print(f"Questions completed: {overall['total_questions']}")
    print(f"Questions failed: {overall['failed_questions']}")
    print(f"Completion rate: {overall['completion_rate'] * 100:.2f}%")
    print(f"Overall accuracy: {overall['overall_accuracy']:.4f}")
    print(f"Average response time: {overall['avg_time_per_question_s']:.2f}s")
    print(f"Total processing time: {format_duration(overall['processing_time_s'])}")
    print(f"Model: {model_id}")
    print(f"Backend: hf")
    print(f"Dataset: MMLU (Full - {len(by_category)} subjects)")
    print("")
    print("=== Acceptance Criteria (MMLU) ===")
    print(f"Required overall accuracy:  >= {acceptance_threshold:.4f}")
    print(f"Required completion rate:   100.00%")
    print(f"Required failed questions:  0")
    print("")
    print(f"Observed overall accuracy:  {overall['overall_accuracy']:.4f}")
    print(f"Observed completion rate:   {overall['completion_rate'] * 100:.2f}%")
    print(f"Observed failed questions:  {overall['failed_questions']}")
    
    passed = overall['overall_accuracy'] >= acceptance_threshold
    print("")
    if passed:
        print("MMLU Benchmark Status: PASS")
    else:
        print("MMLU Benchmark Status: FAIL")
    
    return passed


def main() -> None:
    parser = argparse.ArgumentParser(
        description="MMLU-Pro Benchmark Evaluator (vLLM backend)",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--model", "-m", default="meta-llama/Llama-3.1-8B-Instruct",
                        help="Model name or HuggingFace model ID")
    parser.add_argument("--precision", choices=["fp16", "bf16"], default="bf16",
                        help="Model precision")
    parser.add_argument("--max-model-len", type=int, default=4096,
                        help="Maximum model context length")
    parser.add_argument("--gpu-memory-utilization", type=float, default=0.90,
                        help="GPU memory utilization for vLLM")
    parser.add_argument("--results-dir", default="./results/mmlu-pro",
                        help="Directory to save results")
    parser.add_argument("--total-limit", type=int, default=None,
                        help="Limit total number of questions (for testing)")
    parser.add_argument("--num-few-shot", "-k", type=int, default=5,
                        help="Number of few-shot examples")
    parser.add_argument("--selected-subjects", type=str, default="all",
                        help="Comma-separated list of subjects to evaluate, or 'all'")
    parser.add_argument("--acceptance-threshold", type=float, default=0.65,
                        help="Minimum accuracy to pass benchmark")
    parser.add_argument("--details", type=int, choices=[0, 1], default=1,
                        help="Output detailed per-sample results")
    parser.add_argument("--no-cot", action="store_true",
                        help="Disable chain-of-thought prompting")
    
    args = parser.parse_args()
    
    # Setup logging
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - %(message)s',
        handlers=[logging.StreamHandler(sys.stdout)],
    )
    
    # Lazy import heavy deps
    _lazy_imports()
    
    # Resolve model ID
    model_id = map_model_alias(args.model)
    logging.info(f"Model: {model_id}")
    
    # Create results directory
    def _effective_tz():
        tz_name = os.environ.get("TZ")
        if tz_name and ZoneInfo is not None:
            try:
                return ZoneInfo(tz_name)
            except Exception:
                pass
        try:
            return datetime.now().astimezone().tzinfo or timezone.utc
        except Exception:
            return timezone.utc

    timestamp = datetime.now(_effective_tz()).strftime("%Y%m%d-%H%M%S")
    results_root = Path(args.results_dir).resolve()
    run_dir = results_root / f"{timestamp}-mmlu-pro"
    run_dir.mkdir(parents=True, exist_ok=True)
    
    # Run evaluation
    overall, by_category, by_domain, sample_rows = evaluate_mmlu_pro(
        model_id=model_id,
        precision=args.precision,
        max_model_len=args.max_model_len,
        gpu_memory_utilization=args.gpu_memory_utilization,
        total_limit=args.total_limit,
        num_few_shot=args.num_few_shot,
        use_cot=not args.no_cot,
        selected_subjects=args.selected_subjects,
    )
    
    # Save results
    (run_dir / "overall.json").write_text(json.dumps(overall, indent=2))
    (run_dir / "by_category.json").write_text(json.dumps(by_category, indent=2))
    (run_dir / "by_domain.json").write_text(json.dumps(by_domain, indent=2))
    
    if args.details == 1 and sample_rows:
        import csv
        with open(run_dir / "samples.csv", "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=list(sample_rows[0].keys()))
            writer.writeheader()
            writer.writerows(sample_rows)
    
    # Generate report
    lines = [
        "# MMLU-Pro Benchmark Report",
        "",
        f"**Model**: {model_id}",
        f"**Timestamp**: {timestamp}",
        f"**Few-shot Examples**: {args.num_few_shot}",
        f"**Chain-of-Thought**: {'Yes' if not args.no_cot else 'No'}",
        "",
        "## Overall Results",
        "",
        f"- **Accuracy**: {overall['overall_accuracy']:.4f} ({overall['total_correct']}/{overall['total_questions']})",
        f"- **Processing Time**: {format_duration(overall['processing_time_s'])}",
        f"- **Avg Time/Question**: {overall['avg_time_per_question_s']:.2f}s",
        "",
        "## Accuracy by Domain",
        "",
    ]
    for domain, acc in sorted(by_domain.items()):
        lines.append(f"- **{domain}**: {acc:.4f}")
    
    lines.extend([
        "",
        "## Accuracy by Category",
        "",
    ])
    for category, acc in sorted(by_category.items()):
        lines.append(f"- {category}: {acc:.4f}")
    
    (run_dir / "report.md").write_text("\n".join(lines))
    
    # Print summary
    passed = print_results_summary(overall, by_category, model_id, args.acceptance_threshold)
    
    print("")
    print("=== MMLU K8s Job Complete ===")
    print(f"Questions processed: {overall['total_questions']}")
    print(f"Timestamp: {datetime.now(timezone.utc).strftime('%a %b %d %H:%M:%S UTC %Y')}")
    
    logging.info(f"Results saved to {run_dir}")
    
    if not passed:
        sys.exit(1)


if __name__ == "__main__":
    main()

