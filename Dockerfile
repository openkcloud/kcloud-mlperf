# Optimized MLPerf LLaMA3.1-8B Benchmark Container for NVIDIA A30  
FROM pytorch/pytorch:2.4.0-cuda12.1-cudnn9-devel

SHELL ["/bin/bash", "-c"]

# Environment setup with A30 optimizations
ENV LC_ALL=C.UTF-8
ENV LANG=C.UTF-8
ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONPATH=/app
ENV HF_HOME=/app/.cache/huggingface
ENV CUDA_VISIBLE_DEVICES=0
ENV TOKENIZERS_PARALLELISM=false
ENV PYTORCH_CUDA_ALLOC_CONF=max_split_size_mb:512

# A30-specific optimizations with compatible backends
ENV VLLM_USE_TRITON_FLASH_ATTN=0
ENV VLLM_ATTENTION_BACKEND=FLASH_ATTN
ENV CUDA_LAUNCH_BLOCKING=0
ENV GPU_MAX_HW_QUEUES=8

# Install system dependencies (optimized layer order)
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
    ninja-build \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Install cloudflared to fix MLPerf authentication issues
RUN curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb \
    && dpkg -i cloudflared.deb \
    && rm cloudflared.deb \
    || echo "⚠️  cloudflared installation failed, will use HuggingFace fallback"

WORKDIR /app

# Create cache directories early
RUN mkdir -p /app/results /app/data /app/logs /app/.cache \
    /app/.cache/huggingface/hub \
    /app/.cache/vllm \
    /app/.cache/torch_compile_cache

# Install optimized Python packages in order of dependency
RUN pip3 install --upgrade pip setuptools wheel ninja

# Skip FlashInfer to avoid compatibility issues - use XFormers instead
RUN echo "⚠️  Skipping FlashInfer due to compatibility - using XFormers for optimization"

# Install core ML packages with CUDA optimizations and compatible versions
RUN pip3 install --no-cache-dir \
    mlc-scripts \
    transformers[torch] \
    datasets \
    rouge-score \
    nltk \
    evaluate \
    pandas \
    "numpy>=1.24.0,<1.27.0" \
    accelerate \
    "flash-attn>=2.7.1,<=2.8.0" \
    && pip3 install --no-cache-dir vllm[triton]

# Install MLPerf loadgen (cached layer)
RUN git clone --depth 1 https://github.com/mlcommons/inference.git /tmp/inference && \
    cd /tmp/inference/loadgen && \
    pip3 install pybind11 && \
    python3 setup.py install && \
    rm -rf /tmp/inference

# Copy scripts (these change frequently, so put them last)
COPY entrypoint.sh /app/entrypoint.sh
COPY benchmark_runner.py /app/benchmark_runner.py
COPY report_generator.py /app/report_generator.py

# Set executable permissions
RUN chmod +x /app/entrypoint.sh

# Optimized environment variables for A30
ENV MODEL_NAME="llama3_1-8b"
ENV SCENARIO="_all-scenarios"
ENV CATEGORY="datacenter"
ENV FRAMEWORK="vllm"
ENV DEVICE="cuda"
ENV EXECUTION_MODE="valid"
ENV IMPLEMENTATION="reference"
ENV MLPerf_VERSION="r5.1-dev"
ENV GPU_NAME="A30"

# A30-specific performance settings
ENV VLLM_WORKER_MULTIPROC_METHOD="spawn"
ENV VLLM_ENGINE_ITERATION_TIMEOUT_S="1800"
ENV MAX_MODEL_LEN="8192"
ENV GPU_MEMORY_UTILIZATION="0.95"
ENV TENSOR_PARALLEL_SIZE="1"
ENV BLOCK_SIZE="16"
ENV MAX_NUM_BATCHED_TOKENS="8192"
ENV MAX_NUM_SEQS="256"

# Health check optimized for performance
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD python3 -c "import torch; print('PyTorch:', torch.__version__); print('CUDA available:', torch.cuda.is_available()); print('GPU:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'None')"

# Expose results volume
VOLUME ["/app/results", "/app/data", "/app/.cache"]

# Default entrypoint
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["all-scenarios"]

LABEL org.opencontainers.image.title="MLPerf LLaMA3.1-8B Benchmark (A30 Optimized)"
LABEL org.opencontainers.image.description="A30-optimized MLPerf inference benchmark for LLaMA3.1-8B"
LABEL org.opencontainers.image.version="1.1-a30"
LABEL org.opencontainers.image.vendor="MLCommons"