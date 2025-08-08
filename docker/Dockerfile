# docker/Dockerfile

FROM pytorch/pytorch:2.4.0-cuda12.1-cudnn9-devel

RUN apt-get update && apt-get install -y --no-install-recommends \
    git git-lfs curl wget jq ca-certificates gnupg lsb-release software-properties-common \
 && rm -rf /var/lib/apt/lists/*

# (existing) python deps
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

# 👉 add MMLU harness (hf-causal backend; avoids installing vLLM here)
RUN pip3 install --no-cache-dir "lm-eval==0.4.3" "huggingface_hub>=0.23"

WORKDIR /app
RUN mkdir -p /app/scripts /app/configs /app/results /app/.cache

# your existing copies
COPY scripts /app/scripts
COPY configs /app/configs
COPY llm_eval /app/llm_eval
COPY generate_report_from_json.py /app/generate_report_from_json.py
COPY report_generator.py /app/report_generator.py
COPY docker/entrypoint.sh /app/entrypoint.sh

# 👉 add our tiny CLI
COPY docker/mlbench.sh /usr/local/bin/mlbench
RUN chmod +x /app/entrypoint.sh /app/scripts/*.sh || true && \
    chmod +x /usr/local/bin/mlbench
