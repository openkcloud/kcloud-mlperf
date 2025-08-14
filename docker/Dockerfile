FROM pytorch/pytorch:2.4.0-cuda12.1-cudnn9-devel

# System deps (include unzip for rclone; git-lfs for model weights)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git git-lfs curl wget jq ca-certificates gnupg lsb-release software-properties-common unzip \
    build-essential cmake ninja-build zlib1g-dev \
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
      simplejson \
      accelerate \
      scipy \
      numexpr \
      vllm[triton] \
      "numpy>=1.24.0,<2"

# Optional: FlashInfer (better attention backend with fp8 KV). Wheels are not on PyPI; install
# from vendor wheel index matching CUDA/PyTorch. Ignore failure and fall back to XFormers.
ARG FLASHINFER_WHL_INDEX=https://flashinfer.ai/whl/cu121/torch2.4.html
RUN pip3 install --no-cache-dir -f ${FLASHINFER_WHL_INDEX} flashinfer || echo "FlashInfer not available for this env; falling back to XFormers"

# MMLU evaluation harness + HF hub CLI
RUN pip3 install --no-cache-dir "lm-eval==0.4.3" "huggingface_hub>=0.23"
RUN pip3 install --no-cache-dir "hf_transfer>=0.1.6"

# Build and install MLPerf LoadGen from source (no PyPI wheel available for py311)
RUN git clone --depth=1 https://github.com/mlcommons/inference.git /tmp/mlperf_inference && \
    cd /tmp/mlperf_inference/loadgen && \
    pip3 install --no-cache-dir pybind11 && \
    python3 setup.py bdist_wheel && \
    pip3 install --no-cache-dir dist/*.whl && \
    rm -rf /tmp/mlperf_inference

# Default cache paths (still override-able at runtime)
ENV HF_HOME=/app/.cache/huggingface \
    HF_HUB_CACHE=/app/.cache/huggingface/hub \
    TRANSFORMERS_CACHE=/app/.cache/huggingface \
    HF_DATASETS_CACHE=/app/.cache/huggingface/datasets \
    CM_DOWNLOAD_PATH=/root/MLC/hf_models \
    HF_HUB_ENABLE_HF_TRANSFER=0 \
    HF_HUB_DISABLE_PROGRESS_BARS=1 \
    LD_LIBRARY_PATH=/usr/lib/x86_64-linux-gnu:${LD_LIBRARY_PATH} \
    LD_PRELOAD=/usr/lib/x86_64-linux-gnu/libstdc++.so.6

WORKDIR /app
RUN mkdir -p /app/scripts /app/configs /app/results /app/.cache

# Project files
COPY scripts /app/scripts
COPY configs /app/configs
COPY llm_eval /app/llm_eval
COPY inference-master /app/inference-master
COPY generate_report_from_json.py /app/generate_report_from_json.py
COPY generate_mmlu_report.py /app/generate_mmlu_report.py
COPY report_generator.py /app/report_generator.py
COPY docker/entrypoint.sh /app/entrypoint.sh

# Tiny CLI used by the run script
COPY docker/mlbench.sh /usr/local/bin/mlbench

RUN chmod +x /app/entrypoint.sh /app/scripts/*.sh || true && \
    chmod +x /usr/local/bin/mlbench

# Default entrypoint/command
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["help"]
