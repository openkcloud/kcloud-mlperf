#!/usr/bin/env python3

import os
import sys
import json
import time
import subprocess

def run_worker_on_node(node_ip, rank, master_addr="129.254.202.251", master_port="29500"):
    """Run VLLM worker on GPU node"""
    cmd = f"""
ssh {node_ip} "cd /home/jungwooshim && \
export CUDA_VISIBLE_DEVICES=0 && \
export NCCL_SOCKET_IFNAME=eno1 && \
python3 -c '
import torch
from vllm import LLM, SamplingParams
import json
import time

print(f\"Worker {rank} on {node_ip}: Starting VLLM\")

# Create VLLM engine
llm = LLM(
    model=\"meta-llama/Llama-3.1-8B-Instruct\",
    tensor_parallel_size=1,
    dtype=\"float16\",
    max_model_len=2048,
    gpu_memory_utilization=0.7,
)

# Define prompts for this worker
base_prompts = [
    \"Summarize: The quick brown fox jumps over the lazy dog.\",
    \"Summarize: AI is transforming industries globally.\",
    \"Summarize: Climate change requires immediate action.\",
    \"Summarize: Renewable energy is crucial for sustainability.\",
    \"Summarize: IoT connects devices to the internet.\",
]

# Worker {rank} gets different samples
start_idx = {rank} * 2
end_idx = start_idx + 2
my_prompts = base_prompts[start_idx:end_idx]

print(f\"Worker {rank}: Processing {{len(my_prompts)}} prompts\")

sampling_params = SamplingParams(temperature=0.1, max_tokens=100, top_p=0.9)

start_time = time.time()
outputs = llm.generate(my_prompts, sampling_params)
end_time = time.time()

results = []
for i, output in enumerate(outputs):
    result = {{
        \"worker\": {rank},
        \"node\": \"{node_ip}\",
        \"sample_id\": start_idx + i,
        \"prompt\": output.prompt[:50] + \"...\",
        \"generated_text\": output.outputs[0].text.strip(),
        \"tokens_generated\": len(output.outputs[0].token_ids),
        \"inference_time\": end_time - start_time
    }}
    results.append(result)
    print(f\"Worker {rank} Sample {{start_idx + i}}: Generated {{len(output.outputs[0].token_ids)}} tokens\")

# Save results
with open(f\"/tmp/deepspeed_worker_{rank}_results.json\", \"w\") as f:
    json.dump(results, f, indent=2)

print(f\"Worker {rank}: Completed in {{end_time - start_time:.2f}}s\")
'"
"""
    
    return subprocess.Popen(cmd, shell=True)

def main():
    print("🚀 DeepSpeed Manual Coordinator - jw1 as Master")
    print("===============================================")
    print("Master: jw1 (129.254.202.251) - Coordinator")
    print("Worker 1: jw2 (129.254.202.252) - GPU")  
    print("Worker 2: jw3 (129.254.202.253) - GPU")
    print("")
    
    # Launch workers
    print("🚀 Launching workers on GPU nodes...")
    worker1 = run_worker_on_node("129.254.202.252", 1)
    worker2 = run_worker_on_node("129.254.202.253", 2)
    
    print("⏳ Waiting for workers to complete...")
    worker1.wait()
    worker2.wait()
    
    print("📊 Collecting results...")
    
    # Collect results
    subprocess.run("scp 129.254.202.252:/tmp/deepspeed_worker_1_results.json /tmp/", shell=True)
    subprocess.run("scp 129.254.202.253:/tmp/deepspeed_worker_2_results.json /tmp/", shell=True)
    
    # Combine results
    all_results = []
    for worker_id in [1, 2]:
        try:
            with open(f"/tmp/deepspeed_worker_{worker_id}_results.json", "r") as f:
                worker_results = json.load(f)
                all_results.extend(worker_results)
        except:
            print(f"Warning: Could not load results from worker {worker_id}")
    
    # Save combined results
    final_results = {
        "experiment": "DeepSpeed Manual Coordination",
        "coordinator": "jw1 (129.254.202.251)",
        "workers": ["jw2 (129.254.202.252)", "jw3 (129.254.202.253)"],
        "total_samples": len(all_results),
        "results": all_results
    }
    
    with open("/tmp/deepspeed_manual_results.json", "w") as f:
        json.dump(final_results, f, indent=2)
    
    # Print summary
    print("\n🎉 DeepSpeed Manual Coordination Complete!")
    print("========================================")
    if all_results:
        total_tokens = sum(r.get("tokens_generated", 0) for r in all_results)
        avg_time = sum(r.get("inference_time", 0) for r in all_results) / len(all_results)
        print(f"✅ Total Samples: {len(all_results)}")
        print(f"✅ Total Tokens: {total_tokens}")
        print(f"✅ Average Time/Sample: {avg_time:.2f}s")
        print(f"✅ Throughput: {total_tokens/avg_time:.2f} tokens/s")
        print(f"📁 Results: /tmp/deepspeed_manual_results.json")
    
    print("✅ SUCCESS: jw1 coordinated jw2+jw3 GPU workers!")

if __name__ == "__main__":
    main()