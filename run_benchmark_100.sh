#!/bin/bash
# Run MLPerf benchmark with 100 samples and accuracy

docker run --rm --gpus all --ipc=host --ulimit memlock=-1 --ulimit stack=67108864 \
  -v /home/jungwooshim/MLPerf_local_test/results:/app/results \
  -v /home/jungwooshim/MLPerf_local_test/reports:/app/reports \
  -v /home/jungwooshim/.cache/huggingface:/root/.cache/huggingface \
  -e HF_TOKEN=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 \
  -e SAMPLES=100 \
  -e NODE_NAME=local \
  -e ACCURACY=true \
  -e VLLM_WORKER_MULTIPROC_METHOD=spawn \
  -e DTYPE=float16 \
  -e MAX_MODEL_LEN=1024 \
  -e GPU_MEMORY_UTILIZATION=0.7 \
  -e ENFORCE_EAGER=true \
  mlperf-universal:latest python3 -c "
import os
os.environ['GPU_MEMORY_UTILIZATION'] = '0.7'
os.environ['MAX_MODEL_LEN'] = '1024'
os.environ['ENFORCE_EAGER'] = 'true'
import sys
sys.path.insert(0, '/app')
from bin.run_benchmark import main
sys.argv = ['run_benchmark.py', '--samples', '100', '--accuracy']
main()
"