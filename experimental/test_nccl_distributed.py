#!/usr/bin/env python3

import os
import torch
import torch.distributed as dist
import sys

def test_nccl_setup(rank, world_size, master_addr, master_port):
    """Test NCCL distributed setup"""
    print(f"Rank {rank}: Starting NCCL distributed test")
    
    # Set environment variables
    os.environ['MASTER_ADDR'] = master_addr
    os.environ['MASTER_PORT'] = str(master_port)
    os.environ['RANK'] = str(rank)
    os.environ['WORLD_SIZE'] = str(world_size)
    os.environ['CUDA_VISIBLE_DEVICES'] = '0'  # Use first GPU on each node
    
    try:
        # Check CUDA availability
        if not torch.cuda.is_available():
            print(f"Rank {rank}: CUDA not available")
            return False
            
        device = torch.cuda.current_device()
        print(f"Rank {rank}: Using CUDA device {device}")
        
        # Initialize process group with NCCL backend
        print(f"Rank {rank}: Initializing NCCL process group...")
        dist.init_process_group(
            backend='nccl',
            init_method=f'tcp://{master_addr}:{master_port}',
            rank=rank,
            world_size=world_size,
            timeout=torch.distributed.default_pg_timeout
        )
        
        print(f"Rank {rank}: NCCL process group initialized successfully!")
        
        # Test basic communication with GPU tensors
        tensor = torch.tensor([rank + 1.0]).cuda()
        print(f"Rank {rank}: Original GPU tensor: {tensor}")
        
        # All-reduce operation
        dist.all_reduce(tensor, op=dist.ReduceOp.SUM)
        print(f"Rank {rank}: After all_reduce: {tensor}")
        
        print(f"Rank {rank}: NCCL distributed test completed successfully!")
        
        # Cleanup
        dist.destroy_process_group()
        return True
        
    except Exception as e:
        print(f"Rank {rank}: Error in NCCL setup: {e}")
        return False

if __name__ == "__main__":
    if len(sys.argv) != 4:
        print("Usage: python test_nccl_distributed.py <rank> <world_size> <master_addr>")
        sys.exit(1)
    
    rank = int(sys.argv[1])
    world_size = int(sys.argv[2])
    master_addr = sys.argv[3]
    master_port = 29501  # Different port
    
    success = test_nccl_setup(rank, world_size, master_addr, master_port)
    sys.exit(0 if success else 1)