FROM pytorch/pytorch:2.4.0-cuda12.1-cudnn9-devel

# Avoid interactive prompts
ENV DEBIAN_FRONTEND=noninteractive

# Install system deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    git git-lfs tini && \
    rm -rf /var/lib/apt/lists/* && \
    git lfs install

WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN pip install --upgrade pip && pip install -r /app/requirements.txt

# Copy minimal sources
COPY README.md /app/README.md
COPY run.py /app/run.py
COPY mmlu.py /app/mmlu.py
COPY util_logs.py /app/util_logs.py
COPY report.py /app/report.py

ENV HF_TOKEN=""

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["python", "run.py", "--help"]
