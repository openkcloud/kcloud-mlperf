#!/usr/bin/env python3
"""
Test MLPerf benchmark in CPU mode
"""
import os
import sys
from pathlib import Path

# Add src to path
sys.path.insert(0, str(Path(__file__).parent / "src"))

print("MLPerf Benchmark Test - CPU Mode")
print("=" * 50)

# Check environment
print("\nEnvironment check:")
print(f"Python version: {sys.version}")
print(f"HF_TOKEN set: {'HF_TOKEN' in os.environ}")

# Test imports
try:
    import torch
    print(f"PyTorch version: {torch.__version__}")
    print(f"CUDA available: {torch.cuda.is_available()}")
except ImportError as e:
    print(f"PyTorch import error: {e}")

try:
    import transformers
    print(f"Transformers version: {transformers.__version__}")
except ImportError as e:
    print(f"Transformers import error: {e}")

try:
    import vllm
    print(f"VLLM version: {vllm.__version__}")
except ImportError as e:
    print(f"VLLM import error: {e}")

print("\nNote: To run the full benchmark with GPU support, you need:")
print("1. Install nvidia-container-toolkit")
print("2. Configure Docker daemon for GPU support")
print("3. Restart Docker service")
print("\nFor now, you can run a CPU-only test version.")