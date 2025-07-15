# MLPerf Llama-3.1-8B Benchmark Container
FROM nvidia/cuda:12.1-devel-ubuntu22.04

# Metadata
LABEL maintainer="jungwooshim"
LABEL description="MLPerf Llama-3.1-8B Benchmark Container"
LABEL version="1.0"

# Set environment variables
ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV CUDA_VISIBLE_DEVICES=0
ENV HF_HOME=/app/cache/huggingface
ENV TRANSFORMERS_CACHE=/app/cache/transformers

# Install system dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-dev \
    build-essential \
    git \
    wget \
    curl \
    vim \
    htop \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Upgrade pip
RUN python3 -m pip install --upgrade pip

# Install Python packages
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Clone MLPerf repository
RUN git clone --recursive https://github.com/mlcommons/inference.git mlperf_inference

# Install MLPerf loadgen
WORKDIR /app/mlperf_inference/loadgen
RUN pip install -e .

# Setup working directory
WORKDIR /app/mlperf_inference/language/llama3.1-8b

# Copy benchmark scripts
COPY benchmark_scripts/ ./
COPY docker-entrypoint.sh /app/
RUN chmod +x /app/docker-entrypoint.sh

# Create cache directories
RUN mkdir -p /app/cache/huggingface /app/cache/transformers /app/results

# Set permissions
RUN chmod -R 777 /app/cache /app/results

# Expose port for optional API
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD nvidia-smi || exit 1

# Entry point
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["benchmark"]