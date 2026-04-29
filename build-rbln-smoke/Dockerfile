FROM python:3.10-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HUB_DISABLE_TELEMETRY=1

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates git build-essential pciutils \
    && rm -rf /var/lib/apt/lists/*

# CPU-only torch (no CUDA libs — cuts ~3GB)
RUN pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu \
      torch==2.8.0 torchvision torchaudio

RUN pip install --no-cache-dir \
      transformers==4.57.1 \
      accelerate \
      huggingface_hub \
      numpy \
      sentencepiece \
      protobuf

RUN pip install --no-cache-dir \
      rebel-compiler==0.9.3.post1 \
      optimum-rbln==0.9.3.post1 \
      vllm-rbln==0.9.3.post2 \
      vllm==0.10.2 \
   || pip install --no-cache-dir \
      rebel-compiler optimum-rbln vllm-rbln vllm

WORKDIR /app
COPY tt100t_smoke.py /app/tt100t_smoke.py

CMD ["python", "/app/tt100t_smoke.py"]
