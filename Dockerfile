# Self-contained MLPerf LLaMA3.1-8B Benchmark Container
FROM nvcr.io/nvidia/pytorch:24.07-py3

SHELL ["/bin/bash", "-c"]

# Environment setup
ENV LC_ALL=C.UTF-8
ENV LANG=C.UTF-8
ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONPATH=/app
ENV HF_HOME=/app/.cache/huggingface

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    git \
    curl \
    wget \
    ca-certificates \
    python3-dev \
    python3-pip \
    rsync \
    jq \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install MLCommons CLI and dependencies
RUN pip3 install --upgrade pip setuptools wheel && \
    pip3 install mlc-scripts && \
    pip3 install transformers datasets rouge-score nltk evaluate && \
    pip3 install vllm && \
    pip3 install pandas numpy

# Install MLPerf loadgen
RUN git clone --depth 1 https://github.com/mlcommons/inference.git /tmp/inference && \
    cd /tmp/inference/loadgen && \
    pip3 install pybind11 && \
    python3 setup.py install && \
    rm -rf /tmp/inference

# Create necessary directories
RUN mkdir -p /app/results /app/data /app/logs /app/.cache

# Copy benchmark automation scripts
COPY entrypoint.sh /app/entrypoint.sh
COPY benchmark_runner.py /app/benchmark_runner.py
COPY report_generator.py /app/report_generator.py

# Set executable permissions
RUN chmod +x /app/entrypoint.sh

# Default environment variables
ENV MODEL_NAME="llama3_1-8b"
ENV SCENARIO="_all-scenarios"
ENV CATEGORY="datacenter"
ENV FRAMEWORK="vllm"
ENV DEVICE="cuda"
ENV EXECUTION_MODE="valid"
ENV IMPLEMENTATION="reference"
ENV MLPerf_VERSION="r5.1-dev"
ENV GPU_NAME="A30"

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD python3 -c "import torch; print('PyTorch:', torch.__version__); print('CUDA available:', torch.cuda.is_available())"

# Expose results volume
VOLUME ["/app/results", "/app/data"]

# Default entrypoint
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["all-scenarios"]

# Metadata labels
LABEL org.opencontainers.image.title="MLPerf LLaMA3.1-8B Benchmark"
LABEL org.opencontainers.image.description="Self-contained MLPerf inference benchmark for LLaMA3.1-8B with automated accuracy scoring"
LABEL org.opencontainers.image.version="1.0"
LABEL org.opencontainers.image.vendor="MLCommons"