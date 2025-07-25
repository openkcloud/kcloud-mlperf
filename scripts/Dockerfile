# MLPerf Distributed Benchmarking Container
# Supports Kubernetes deployment with TorchX and DeepSpeed
FROM ubuntu:22.04

# Metadata
LABEL maintainer="jungwooshim"
LABEL description="MLPerf Distributed Benchmarking with Kubernetes Support"
LABEL version="2.0"

# Set environment variables
ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV CUDA_VISIBLE_DEVICES=0
ENV HF_HOME=/workspace/cache/huggingface
ENV TRANSFORMERS_CACHE=/workspace/cache/transformers

# Install system dependencies
RUN apt-get update --fix-missing && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-dev \
    build-essential \
    git \
    wget \
    curl \
    && rm -rf /var/lib/apt/lists/* && apt-get clean

# Skip SSH setup - not needed for K8s orchestration

# Create workspace
WORKDIR /workspace

# Install Python dependencies
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

# Install TorchX for distributed training
RUN pip3 install torchx[kubernetes]

# Install DeepSpeed
RUN pip3 install deepspeed

# Copy MLPerf benchmark code
COPY official_mlperf /workspace/official_mlperf
COPY src /workspace/src
COPY k8s /workspace/k8s

# Install MLPerf loadgen
RUN cd /workspace/official_mlperf/loadgen && python3 setup.py install

# Create cache and results directories
RUN mkdir -p /workspace/cache/huggingface /workspace/cache/transformers /workspace/results

# Set permissions
RUN chmod -R 777 /workspace/cache /workspace/results
RUN chmod +x /workspace/src/*.py

# Expose ports for distributed training
EXPOSE 22 29500 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD python3 --version || exit 1

# Default command
CMD ["python3", "--version"]
