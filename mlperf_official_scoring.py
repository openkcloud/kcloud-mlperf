#!/usr/bin/env python3
"""
MLPerf Official ROUGE Scoring Implementation
==========================================

Based on the official MLPerf Inference v5.1 evaluation.py and ref_eval.py
Uses the exact same ROUGE scoring methodology as MLPerf reference implementation.
"""

import os
import sys
import json
import time
import logging
import argparse
import numpy as np
import pandas as pd
from pathlib import Path
from datetime import datetime

# MLPerf Official Dependencies
import nltk
import evaluate
import re
from transformers import AutoTokenizer

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)

class MLPerfScorer:
    """Official MLPerf Scorer based on evaluation.py and ref_eval.py"""
    
    def __init__(self, model_name="meta-llama/Meta-Llama-3.1-8B-Instruct"):
        self.model_name = model_name
        
        # Initialize ROUGE scorer exactly as MLPerf does
        self.rouge_metric = evaluate.load("rouge")
        
        # Download required NLTK data
        try:
            nltk.download("punkt", quiet=True)
            nltk.download('punkt_tab', quiet=True)
        except:
            pass
        
        # Initialize tokenizer for consistency
        self.tokenizer = AutoTokenizer.from_pretrained(
            model_name,
            model_max_length=128000,
            padding_side="left",
            use_fast=False,
        )
        self.tokenizer.pad_token = self.tokenizer.eos_token
        
        logger.info(f"✅ MLPerf Official Scorer initialized with {model_name}")

    def postprocess_text(self, preds, targets):
        """
        Official MLPerf text postprocessing from evaluation.py
        """
        preds = [pred.strip() for pred in preds]
        targets = [target.strip() for target in targets]

        # rougeLSum expects newline after each sentence - CRITICAL MLPerf requirement
        preds = ["\n".join(nltk.sent_tokenize(pred)) for pred in preds]
        targets = ["\n".join(nltk.sent_tokenize(target)) for target in targets]

        return preds, targets

    def rouge_ref_eval(self, label, pred):
        """ROUGE scoring from ref_eval.py using evaluate library"""
        # Use the same evaluate library for consistency
        result = self.rouge_metric.compute(
            predictions=[pred], 
            references=[label], 
            use_stemmer=True,
            use_aggregator=False
        )
        return {
            'rougeL': round(result['rougeL'][0] * 100, 4),
        }

    def niah_em(self, label, pred):
        """NIAH Exact Match from ref_eval.py"""
        label_uuids = re.findall(
            r'[\w]{8}-[\w]{4}-[\w]{4}-[\w]{4}-[\w]{12}', label)
        pred_uuids = re.findall(r'[\w]{8}-[\w]{4}-[\w]{4}-[\w]{4}-[\w]{12}', pred)

        if not pred_uuids or not label_uuids:
            return {'exact_match': 0.0}

        # MLPerf official NIAH scoring
        score = sum([
            sum([1.0 if r.lower() in pred.lower() else 0.0 for r in ref]) / len(ref)
            for pred, ref in zip(pred_uuids, label_uuids)
        ]) / len(pred_uuids) * 100

        return {'exact_match': round(score, 2)}

    def qa_em(self, label, pred):
        """QA Exact Match from ref_eval.py"""
        answer_substring = pred

        if 'Answer: ' in pred:
            last_answer_index = pred.rfind("Answer: ")
            if last_answer_index == -1:
                return {'exact_match': 0.0}

            answer_substring = pred[last_answer_index + len("Answer: "):]

        if answer_substring in label:
            return {'exact_match': 100.0}

        normalized_answer = re.sub(r'\s+', '', answer_substring).lower()
        label_entries = [re.sub(r'\s+', '', entry).lower()
                         for entry in label.split('|')]

        match_found = any(entry in normalized_answer for entry in label_entries)
        return {'exact_match': 100.0 if match_found else 0.0}

    def calculate_comprehensive_scores(self, predictions, references, task_type="cnn_dailymail"):
        """
        Calculate all available MLPerf metrics
        """
        logger.info("📊 Calculating comprehensive MLPerf scores...")
        
        # Primary ROUGE evaluation (for CNN-DailyMail)
        preds, targets = self.postprocess_text(predictions, references)
        
        # Calculate ROUGE using exact MLPerf parameters
        result = self.rouge_metric.compute(
            predictions=preds, 
            references=targets, 
            use_stemmer=True,      # MLPerf uses stemming
            use_aggregator=False   # MLPerf doesn't use aggregation
        )
        
        # Convert to percentage and round to 4 decimal places - EXACT MLPerf format
        rouge_scores = {k: round(float(np.mean(v)) * 100, 4) for k, v in result.items()}
        
        # Calculate generation metrics
        prediction_lens = [len(pred) for pred in preds]
        rouge_scores["gen_len"] = int(np.sum(prediction_lens))
        rouge_scores["gen_num"] = len(preds)
        
        # Additional ref_eval.py metrics for comprehensive evaluation
        if task_type == "cnn_dailymail":
            # Also calculate ref_eval ROUGE for comparison
            ref_rouge_scores = []
            for pred, ref in zip(predictions, references):
                ref_score = self.rouge_ref_eval(ref, pred)
                ref_rouge_scores.append(ref_score['rougeL'])
            
            rouge_scores["ref_rougeL"] = round(float(np.mean(ref_rouge_scores)), 4)
        
        # Calculate exact match metrics for QA-style evaluation
        qa_em_scores = []
        niah_em_scores = []
        
        for pred, ref in zip(predictions, references):
            # QA Exact Match
            qa_score = self.qa_em(ref, pred)
            qa_em_scores.append(qa_score['exact_match'])
            
            # NIAH Exact Match (for UUID-based tasks)
            niah_score = self.niah_em(ref, pred)
            niah_em_scores.append(niah_score['exact_match'])
        
        rouge_scores["qa_exact_match"] = round(float(np.mean(qa_em_scores)), 4)
        rouge_scores["niah_exact_match"] = round(float(np.mean(niah_em_scores)), 4)
        
        return rouge_scores

    def evaluate_mlperf_compliance(self, rouge_scores):
        """
        Check MLPerf compliance against official targets
        """
        # Official MLPerf Datacenter targets
        mlperf_targets = {
            "rouge1": 38.7792,     # 99% target
            "rouge2": 15.9075,     # 99% target  
            "rougeL": 24.4957,     # 99% target
            "rougeLsum": 35.793,   # 99% target
            "gen_len": 8167644,    # 90% target
            "gen_num": 13368,      # Expected number
        }
        
        compliance_results = {}
        all_pass = True
        
        for metric, target in mlperf_targets.items():
            if metric in rouge_scores:
                achieved = rouge_scores[metric]
                
                if metric == "gen_len":
                    # 90% target for generation length
                    threshold = target * 0.9
                    passed = achieved >= threshold
                else:
                    # 99% target for ROUGE metrics
                    passed = achieved >= target
                
                compliance_results[f"{metric}_pass"] = passed
                compliance_results[f"{metric}_target"] = target
                compliance_results[f"{metric}_achieved"] = achieved
                compliance_results[f"{metric}_margin"] = achieved - target
                
                if not passed:
                    all_pass = False
                    
                status = "✅ PASS" if passed else "❌ FAIL"
                logger.info(f"   • {metric.upper()}: {achieved} vs {target} = {status}")
        
        compliance_results["all_targets_met"] = all_pass
        
        return compliance_results

def evaluate_with_mlperf(predictions, references, model_name="meta-llama/Meta-Llama-3.1-8B-Instruct", task_type="cnn_dailymail"):
    """
    Main evaluation function using official MLPerf methodology with all metrics
    """
    scorer = MLPerfScorer(model_name)
    
    # Calculate comprehensive scores including all MLPerf metrics
    rouge_scores = scorer.calculate_comprehensive_scores(predictions, references, task_type)
    
    # Check compliance
    compliance = scorer.evaluate_mlperf_compliance(rouge_scores)
    
    # Create results in MLPerf format
    results = {
        "accuracy": rouge_scores,
        "mlperf_compliance": compliance,
        "evaluation_method": "MLPerf Official Comprehensive Scorer",
        "rouge_library": "evaluate + rouge_score + ref_eval",
        "postprocessing": "NLTK sentence tokenization + stemming + exact match",
        "metrics_included": [
            "rouge1", "rouge2", "rougeL", "rougeLsum", 
            "gen_len", "gen_num", "ref_rougeL", 
            "qa_exact_match", "niah_exact_match"
        ]
    }
    
    return results

def main():
    """Test the MLPerf scorer with sample data"""
    parser = argparse.ArgumentParser(description="MLPerf Official ROUGE Scoring")
    parser.add_argument("--predictions", required=True, help="JSON file with predictions")
    parser.add_argument("--references", required=True, help="JSON file with references") 
    parser.add_argument("--output", help="Output file for results")
    parser.add_argument("--model-name", default="meta-llama/Meta-Llama-3.1-8B-Instruct", help="Model name")
    
    args = parser.parse_args()
    
    # Load data
    logger.info("📁 Loading prediction and reference data...")
    
    with open(args.predictions, 'r') as f:
        predictions = json.load(f)
    
    with open(args.references, 'r') as f:
        references = json.load(f)
    
    # Ensure same length
    min_len = min(len(predictions), len(references))
    predictions = predictions[:min_len]
    references = references[:min_len]
    
    logger.info(f"📊 Evaluating {len(predictions)} samples with MLPerf official scoring...")
    
    # Run evaluation
    results = evaluate_with_mlperf(predictions, references, args.model_name)
    
    # Save results
    if args.output:
        with open(args.output, 'w') as f:
            json.dump(results, f, indent=2)
        logger.info(f"💾 Results saved to {args.output}")
    
    # Print summary
    logger.info("🎯 MLPerf Official ROUGE Scores:")
    for metric, score in results["accuracy"].items():
        logger.info(f"   • {metric}: {score}")
    
    logger.info("📋 MLPerf Compliance:")
    compliance = results["mlperf_compliance"]
    if compliance["all_targets_met"]:
        logger.info("✅ ALL TARGETS MET - READY FOR SUBMISSION!")
    else:
        logger.info("⚠️  Some targets not met - check configuration")

if __name__ == "__main__":
    main()