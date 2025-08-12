FROM pytorch/pytorch:2.4.0-cuda12.1-cudnn9-devel

# System deps (include unzip for rclone; git-lfs for model weights)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git git-lfs curl wget jq ca-certificates gnupg lsb-release software-properties-common unzip \
 && rm -rf /var/lib/apt/lists/*

# Python deps
RUN pip3 install --upgrade pip setuptools wheel && \
    pip3 install --no-cache-dir \
      mlc-scripts \
      transformers[torch] \
      datasets \
      rouge-score \
      nltk \
      evaluate \
      pandas \
      "numpy>=1.24.0,<2"

# MMLU evaluation harness + HF hub CLI
RUN pip3 install --no-cache-dir "lm-eval==0.4.3" "huggingface_hub>=0.23"
RUN pip3 install --no-cache-dir "hf_transfer>=0.1.6"

# Default cache paths (still override-able at runtime)
ENV HF_HOME=/app/.cache/huggingface \
    HF_HUB_CACHE=/app/.cache/huggingface/hub \
    TRANSFORMERS_CACHE=/app/.cache/huggingface \
    HF_DATASETS_CACHE=/app/.cache/huggingface/datasets \
    CM_DOWNLOAD_PATH=/root/MLC/hf_models

WORKDIR /app
RUN mkdir -p /app/scripts /app/configs /app/results /app/.cache

# Project files
COPY scripts /app/scripts
COPY configs /app/configs
COPY llm_eval /app/llm_eval
COPY generate_report_from_json.py /app/generate_report_from_json.py
COPY report_generator.py /app/report_generator.py
COPY docker/entrypoint.sh /app/entrypoint.sh

# Tiny CLI used by the run script
COPY docker/mlbench.sh /usr/local/bin/mlbench

RUN chmod +x /app/entrypoint.sh /app/scripts/*.sh || true && \
    chmod +x /usr/local/bin/mlbench
