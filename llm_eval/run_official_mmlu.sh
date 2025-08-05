#!/bin/bash
set -e

# Export HuggingFace API token
export HUGGINGFACEHUB_API_TOKEN=$HF_TOKEN

# Run the MMLU evaluation
python llm_eval/evaluate_official_mmlu.py \
  --model meta-llama/Llama-3.1-8B-Instruct \
  --dataset cais/mmlu \
  --batch_size 16 \
  --output /results/mmlu_results.json

# Exit on error is already handled by set -e