from dataset import Dataset
import os
import time
import numpy as np
import json
import nltk
import array
import torch
from torch.nn.functional import pad
from torch.utils.data import DataLoader
import evaluate
import argparse
import nltk
from transformers import AutoModelForCausalLM, AutoTokenizer


def get_args():
    """Parse commandline."""
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--mlperf-accuracy-file", required=True, help="path to mlperf_log_accuracy.json"
    )
    parser.add_argument(
        "--dataset-file",
        required=True,
        help="path to cnn_eval.json")
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="verbose messages")
    parser.add_argument(
        "--dtype",
        default="int64",
        help="dtype of the accuracy log",
        choices=["int32", "int64"],
    )
    parser.add_argument(
        "--model-name",
        default="meta-llama/Meta-Llama-3.1-8B-Instruct",
        help="Model name")
    parser.add_argument(
        "--total-sample-count",
        default=13368,
        type=int,
        help="Model name")
    args = parser.parse_args()
    return args


def postprocess_text(preds, targets):
    preds = [pred.strip() for pred in preds]
    targets = [target.strip() for target in targets]

    # rougeLSum expects newline after each sentence
    preds = ["\n".join(nltk.sent_tokenize(pred)) for pred in preds]
    targets = ["\n".join(nltk.sent_tokenize(target)) for target in targets]

    return preds, targets


def check_accuracy_targets(result):
    """Check against official MLCommons LLaMA3.1-8B accuracy targets"""
    
    # Official MLCommons accuracy targets (99% of baseline)
    targets = {
        "rouge1": 38.7792 * 0.99,      # 38.392
        "rouge2": 15.9075 * 0.99,      # 15.749  
        "rougeL": 24.4957 * 0.99,      # 24.251
        "rougeLsum": 35.793 * 0.99,    # 35.435
        "gen_len": 8167644 * 0.9,      # 7350880 (90% for generation length)
    }
    
    print(f"\n{'='*70}")
    print("📋 MLCOMMONS ACCURACY TARGET VALIDATION")
    print(f"{'='*70}")
    
    passed_all = True
    
    for metric, target in targets.items():
        if metric in result:
            if metric == "gen_len":
                actual = int(result[metric])
                passed = actual >= target
                status = "✅ PASS" if passed else "❌ FAIL"
                print(f"{metric.upper():<12}: {actual:>10} >= {target:>10.0f} {status}")
            else:
                actual = float(result[metric])
                passed = actual >= target
                status = "✅ PASS" if passed else "❌ FAIL"
                print(f"{metric.upper():<12}: {actual:>10.4f}% >= {target:>7.3f}% {status}")
            
            if not passed:
                passed_all = False
        else:
            print(f"{metric.upper():<12}: {'MISSING':>10} {'❌ FAIL':>10}")
            passed_all = False
    
    print(f"{'='*70}")
    if passed_all:
        print("🎉 ALL ACCURACY TARGETS PASSED - MLCommons Compliant!")
    else:
        print("⚠️  Some accuracy targets not met - Review model performance")
    print(f"{'='*70}")
    
    return passed_all


def main():

    args = get_args()
    model_name = args.model_name
    dataset_path = args.dataset_file
    total_sample_count = args.total_sample_count
    metric = evaluate.load("rouge")
    nltk.download("punkt")
    nltk.download('punkt_tab')

    tokenizer = AutoTokenizer.from_pretrained(
        model_name,
        model_max_length=2048,
        padding_side="left",
        use_fast=False,
    )
    tokenizer.pad_token = tokenizer.eos_token
    data_object = Dataset(
        model_name=args.model_name,
        dataset_path=dataset_path,
        total_sample_count=total_sample_count,
        dtype=args.dtype
    )

    targets = data_object.targets

    with open(args.mlperf_accuracy_file, "r") as f:
        results = json.load(f)

    # Deduplicate the results loaded from the json
    dedup_results = []
    seen = set()
    for result in results:
        item = result["qsl_idx"]
        if item not in seen:
            seen.add(item)
            dedup_results.append(result)
    results = dedup_results

    target_required = []
    preds_token_ids = []

    eval_dtype = np.int64
    if args.dtype == "int32":
        eval_dtype = np.int32

    for pred in results:
        qsl_idx = pred["qsl_idx"]
        target = targets[qsl_idx]
        target_required.append(target)
        preds_token_ids.append(
            np.frombuffer(
                bytes.fromhex(
                    pred["data"]),
                eval_dtype))

    preds_decoded_text = tokenizer.batch_decode(
        preds_token_ids, skip_special_tokens=True
    )

    preds, targets = postprocess_text(preds_decoded_text, target_required)

    result = metric.compute(
        predictions=preds, references=targets, use_stemmer=True, use_aggregator=False
    )
    result = {k: f"{round(np.mean(v) * 100, 4)}" for k, v in result.items()}
    prediction_lens = [len(pred) for pred in preds]
    result["gen_len"] = np.sum(prediction_lens)
    result["gen_num"] = len(preds)
    
    print(f"\n{'='*70}")
    print("📈 OFFICIAL MLCOMMONS LLAMA3.1-8B EVALUATION RESULTS")
    print(f"{'='*70}")
    
    # Enhanced display of ROUGE scores
    rouge_scores = {}
    for key, value in result.items():
        if key.startswith('rouge'):
            rouge_scores[key] = value
    
    if rouge_scores:
        print(f"\n📊 ROUGE Scores (%):")
        for metric_name, score in rouge_scores.items():
            print(f"   {metric_name.upper():<12}: {score}")
    
    print(f"\n📝 Generation Statistics:")
    print(f"   Generated Tokens : {result['gen_len']}")
    print(f"   Number of Samples: {result['gen_num']}")
    
    # Check against official MLCommons targets
    check_accuracy_targets(result)
    
    print(f"\n{'='*70}")
    print("Raw Results (for compatibility):")
    print(result)
    print(f"{'='*70}")


if __name__ == "__main__":
    main()