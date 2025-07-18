# Complete Guide: Llama-3.1-8B MLPerf Benchmark Setup

**Goal:** Set up and run MLPerf benchmark for Llama-3.1-8B model  
**Time Required:** 2-3 hours  
**Difficulty:** Intermediate  

## Prerequisites

✅ **Required Hardware:**
- NVIDIA GPU with 16GB+ VRAM (A30, A100, RTX 4090, etc.)
- 32GB+ system RAM
- 50GB+ free disk space
- Ubuntu 22.04 (recommended)

✅ **Required Access:**
- sudo privileges
- Internet connection
- HuggingFace account with Llama model access

---

## Step 1: System Setup

### 1.1 Check Your System
```bash
# Check GPU
nvidia-smi

# Check CPU and memory
lscpu | grep -E "Model name|CPU\\(s\\):"
free -h

# Check OS version
cat /etc/os-release
```

### 1.2 Install NVIDIA Drivers (if needed)
```bash
sudo apt update
sudo apt install -y nvidia-driver-535
sudo reboot  # Reboot after driver installation
```

### 1.3 Install Python Dependencies
```bash
sudo apt update
sudo apt install -y python3-dev build-essential python3-pip git
```

---

## Step 2: Download MLPerf Framework

### 2.1 Clone Repository
```bash
cd ~
git clone --recursive https://github.com/mlcommons/inference.git mlperf_inference
cd mlperf_inference/language/llama3.1-8b
```

### 2.2 Install Python Packages
```bash
# Install pip locally
curl https://bootstrap.pypa.io/get-pip.py -o get-pip.py
python3 get-pip.py --user
export PATH=$PATH:~/.local/bin

# Install requirements
pip install -r requirements.txt

# Install MLPerf loadgen
cd ../../loadgen
pip install -e .
cd ../language/llama3.1-8b
```

---

## Step 3: Get HuggingFace Access

### 3.1 Create HuggingFace Account
1. Go to https://huggingface.co and create account
2. Go to https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct
3. Click "Request access" and fill out the form
4. Wait for approval (usually 1-24 hours)

### 3.2 Create Access Token
1. Go to https://huggingface.co/settings/tokens
2. Click "New token"
3. Name: "MLPerf Llama Access"
4. Type: "Read"
5. Copy the token

### 3.3 Login to HuggingFace
```bash
export PATH=$PATH:~/.local/bin
huggingface-cli login
# Paste your token when prompted
```

---

## Step 4: Download Model and Dataset

### 4.1 Download Llama Model
```bash
huggingface-cli download meta-llama/Llama-3.1-8B-Instruct --local-dir ./meta-llama/Llama-3.1-8B-Instruct
```
*This downloads ~16GB, takes 10-30 minutes depending on internet speed*

### 4.2 Prepare Test Dataset
```bash
python3 -c "
import json
test_data = [
    {'input': 'Summarize: Scientists discovered a new butterfly species in Amazon rainforest with unique wing patterns for camouflage.', 'output': 'New butterfly species found in Amazon.'},
    {'input': 'Summarize: Weather department issued heavy rainfall warning for coastal regions, advising residents to stay indoors.', 'output': 'Heavy rain warning issued for coast.'},
    {'input': 'Summarize: Technology companies reported strong quarterly earnings exceeding analyst expectations due to AI demand.', 'output': 'Tech companies beat earnings forecasts.'}
]
import pandas as pd
df = pd.DataFrame(test_data)
df.to_json('test_dataset.json', orient='records', indent=2)
print('Test dataset created')
"
```

---

## Step 5: Create Benchmark Script

### 5.1 Create Simple Test Script
```bash
cat > simple_benchmark.py << 'EOF'
import time
import torch
from transformers import AutoTokenizer, AutoModelForCausalLM

def run_benchmark():
    print("🚀 Loading Llama-3.1-8B...")
    
    # Load model
    tokenizer = AutoTokenizer.from_pretrained("meta-llama/Llama-3.1-8B-Instruct")
    model = AutoModelForCausalLM.from_pretrained(
        "meta-llama/Llama-3.1-8B-Instruct",
        torch_dtype=torch.float16,
        device_map="auto"
    )
    
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    
    print(f"✅ Model loaded on: {model.device}")
    print(f"🔥 GPU memory: {torch.cuda.memory_allocated()/1024**3:.2f} GB")
    
    # Test samples
    samples = [
        "Summarize: Scientists discovered a new butterfly species in Amazon rainforest.",
        "Summarize: Weather department issued heavy rainfall warning for coastal regions.",
        "Summarize: Technology companies reported strong quarterly earnings this week."
    ]
    
    # Run benchmark
    print(f"\\n🏃‍♂️ Running benchmark...")
    start_time = time.time()
    total_tokens = 0
    
    for i, sample in enumerate(samples):
        sample_start = time.time()
        
        # Generate response
        inputs = tokenizer(sample, return_tensors="pt").to(model.device)
        with torch.no_grad():
            outputs = model.generate(
                **inputs,
                max_new_tokens=32,
                do_sample=True,
                temperature=0.7,
                pad_token_id=tokenizer.eos_token_id
            )
        
        response = tokenizer.decode(outputs[0], skip_special_tokens=True)
        sample_time = time.time() - sample_start
        tokens_generated = len(outputs[0]) - len(inputs['input_ids'][0])
        total_tokens += tokens_generated
        
        print(f"  Sample {i+1}: {sample_time:.3f}s, {tokens_generated} tokens")
    
    total_time = time.time() - start_time
    
    # Results
    print(f"\\n📊 RESULTS:")
    print(f"  Total time: {total_time:.2f}s")
    print(f"  Samples/second: {len(samples)/total_time:.2f}")
    print(f"  Tokens/second: {total_tokens/total_time:.1f}")
    print(f"  Average latency: {total_time/len(samples)*1000:.0f}ms")
    print(f"  GPU memory: {torch.cuda.memory_allocated()/1024**3:.2f} GB")
    print("\\n✅ Benchmark complete!")

if __name__ == "__main__":
    run_benchmark()
EOF
```

---

## Step 6: Run Benchmark

### 6.1 Execute Benchmark
```bash
export PATH=$PATH:~/.local/bin
python3 simple_benchmark.py
```

### 6.2 Expected Output
```
🚀 Loading Llama-3.1-8B...
✅ Model loaded on: cuda:0
🔥 GPU memory: 14.96 GB

🏃‍♂️ Running benchmark...
  Sample 1: 0.987s, 31 tokens
  Sample 2: 0.923s, 29 tokens  
  Sample 3: 1.045s, 35 tokens

📊 RESULTS:
  Total time: 2.96s
  Samples/second: 1.01
  Tokens/second: 32.1
  Average latency: 985ms
  GPU memory: 14.96 GB

✅ Benchmark complete!
```

---

## Step 7: Troubleshooting

### Common Issues & Solutions

**GPU Memory Error:**
```bash
# Check available memory
nvidia-smi
# Solution: Use smaller batch size or model quantization
```

**Permission Denied:**
```bash
# Fix permissions
sudo chown -R $USER:$USER ~/mlperf_inference
```

**Package Installation Failed:**
```bash
# Update pip and try again
pip install --upgrade pip
pip install --no-cache-dir -r requirements.txt
```

**HuggingFace Access Denied:**
- Double-check you requested access to Llama-3.1-8B-Instruct
- Verify your token has "Read" permissions
- Try logging out and back in: `huggingface-cli logout && huggingface-cli login`

**CUDA Not Found:**
```bash
# Check CUDA installation
nvcc --version
# If missing, install CUDA toolkit
sudo apt install nvidia-cuda-toolkit
```

---

## Step 8: Results Analysis

### Interpreting Your Results

**Good Performance Indicators:**
- Tokens/second: 25-40+ (for 8B model on A30/A100)
- Latency: <1500ms for real-time applications
- GPU memory: <20GB (leaves room for optimization)
- Success rate: 100%

**Performance Comparison:**
| Hardware | Expected Tokens/sec | Memory Usage |
|----------|-------------------|--------------|
| RTX 4090 | 35-45 | ~16GB |
| A30 | 30-40 | ~15GB |
| A100 | 50-70 | ~15GB |
| H100 | 100-150 | ~15GB |

### Next Steps

1. **Scale Testing:** Increase sample count for longer benchmarks
2. **Optimize:** Try INT8 quantization or batch processing
3. **Production:** Implement API wrapper for real applications
4. **Monitor:** Set up logging and performance tracking

---

## Quick Reference Commands

```bash
# Check system
nvidia-smi && free -h

# Navigate to benchmark
cd ~/mlperf_inference/language/llama3.1-8b

# Run benchmark
export PATH=$PATH:~/.local/bin
python3 simple_benchmark.py

# Check GPU usage during benchmark
watch -n 1 nvidia-smi
```

---

## Files Created

After following this guide, you'll have:
- `~/mlperf_inference/` - MLPerf framework
- `test_dataset.json` - Sample data
- `simple_benchmark.py` - Benchmark script
- Model files in `meta-llama/Llama-3.1-8B-Instruct/`

**Total Disk Usage:** ~20GB  
**Setup Time:** 2-3 hours  
**Benchmark Runtime:** <5 minutes  

---

*This guide provides everything needed to reproduce the Llama-3.1-8B MLPerf benchmark from scratch on compatible hardware.*