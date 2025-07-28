# MLPerf Universal Benchmark Container
# Supports both single-node and distributed Kubernetes deployments
FROM nvcr.io/nvidia/pytorch:24.07-py3

SHELL ["/bin/bash", "-c"]

# Environment setup
ENV LC_ALL=C.UTF-8
ENV LANG=C.UTF-8
ENV DEBIAN_FRONTEND=noninteractive
ENV VLLM_WORKER_MULTIPROC_METHOD=spawn

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
    && rm -rf /var/lib/apt/lists/*

# Create working directory
WORKDIR /app

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip3 install --upgrade pip setuptools wheel
RUN pip3 install -r requirements.txt

# Install MLPerf loadgen
WORKDIR /tmp
RUN git clone --depth 1 https://github.com/mlcommons/inference.git && \
    cd inference/loadgen && \
    pip install -e . && \
    cd / && rm -rf /tmp/inference

# Copy MLPerf framework
WORKDIR /app
COPY . .

# Create necessary directories
RUN mkdir -p /app/results /app/reports /app/cache /app/logs

# Set proper permissions
RUN chmod +x bin/*.py
RUN chmod +x *.py

# Default environment variables (can be overridden)
ENV HF_TOKEN=""
ENV SAMPLES=13368
ENV ACCURACY=false
ENV NODE_NAME="local"
ENV OUTPUT_DIR="/app/results"

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD python3 -c "import torch; print('PyTorch:', torch.__version__); print('CUDA available:', torch.cuda.is_available())"

# Default command - run full benchmark
CMD ["python3", "bin/run_benchmark.py", "--samples", "13368"]