#!/usr/bin/env python3

import os
import torch
import torch.distributed as dist
import sys

def test_distributed_setup(rank, world_size, master_addr, master_port):
    """Test basic PyTorch distributed setup"""
    print(f"Rank {rank}: Starting distributed test")
    
    # Set environment variables
    os.environ['MASTER_ADDR'] = master_addr
    os.environ['MASTER_PORT'] = str(master_port)
    os.environ['RANK'] = str(rank)
    os.environ['WORLD_SIZE'] = str(world_size)
    
    try:
        # Initialize process group with gloo backend
        print(f"Rank {rank}: Initializing process group...")
        dist.init_process_group(
            backend='gloo',
            init_method=f'tcp://{master_addr}:{master_port}',
            rank=rank,
            world_size=world_size,
            timeout=torch.distributed.default_pg_timeout
        )
        
        print(f"Rank {rank}: Process group initialized successfully!")
        
        # Test basic communication
        tensor = torch.tensor([rank + 1.0])
        print(f"Rank {rank}: Original tensor: {tensor}")
        
        # All-reduce operation
        dist.all_reduce(tensor, op=dist.ReduceOp.SUM)
        print(f"Rank {rank}: After all_reduce: {tensor}")
        
        print(f"Rank {rank}: Distributed test completed successfully!")
        
        # Cleanup
        dist.destroy_process_group()
        return True
        
    except Exception as e:
        print(f"Rank {rank}: Error in distributed setup: {e}")
        return False

if __name__ == "__main__":
    if len(sys.argv) != 4:
        print("Usage: python test_pytorch_distributed.py <rank> <world_size> <master_addr>")
        sys.exit(1)
    
    rank = int(sys.argv[1])
    world_size = int(sys.argv[2])
    master_addr = sys.argv[3]
    master_port = 29500
    
    success = test_distributed_setup(rank, world_size, master_addr, master_port)
    sys.exit(0 if success else 1)