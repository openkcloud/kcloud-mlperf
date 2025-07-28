#!/usr/bin/env python3
"""
Official MLPerf-compliant Dataset implementation for Llama3.1-8B
Based on the official MLPerf inference repository
"""

import os
import json
import logging
import numpy as np
import pandas as pd
from typing import List, Dict, Any, Optional

import mlperf_loadgen as lg

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class MLPerfDataset:
    """MLPerf-compliant dataset for Llama3.1-8B"""
    
    def __init__(
        self,
        dataset_path: str,
        total_sample_count: int = 13368,
        perf_count_override: Optional[int] = None,
        model_name: str = "meta-llama/Llama-3.1-8B-Instruct"
    ):
        self.model_name = model_name
        self.dataset_path = dataset_path
        
        logger.info(f"Initializing MLPerf dataset from {dataset_path}")
        
        # Load the processed dataset
        self.load_processed_dataset()
        
        # Set sample counts
        self.total_sample_count = min(len(self.input_ids), total_sample_count)
        self.perf_count = perf_count_override or self.total_sample_count
        
        logger.info(f"Dataset loaded with {self.total_sample_count} samples")
        logger.info(f"Performance sample count: {self.perf_count}")
        
    def load_processed_dataset(self):
        """Load the preprocessed dataset from JSON file"""
        if not os.path.isfile(self.dataset_path):
            raise FileNotFoundError(
                f"Processed dataset file {self.dataset_path} not found. "
                "Please run scripts/download-dataset.py first."
            )
        
        logger.info("Loading processed dataset...")
        
        # Load the JSON data
        with open(self.dataset_path, 'r') as f:
            data = json.load(f)
        
        # Convert to the expected format
        self.input = [sample['input'] for sample in data]
        self.input_ids = [sample['tok_input'] for sample in data]
        self.input_lens = [len(x) for x in self.input_ids]
        self.targets = [sample['output'] for sample in data]
        
        logger.info("Dataset loaded successfully")
        
    def get_item_count(self) -> int:
        """Return total number of samples in dataset"""
        return self.total_sample_count
    
    def get_samples(self, sample_list: List[int]) -> List[str]:
        """Get samples by index for MLPerf LoadGen"""
        return [self.input[i] for i in sample_list]
    
    def get_sample_input_ids(self, sample_index: int) -> List[int]:
        """Get tokenized input for a specific sample"""
        return self.input_ids[sample_index]
    
    def get_sample_input_text(self, sample_index: int) -> str:
        """Get input text for a specific sample"""
        return self.input[sample_index]
    
    def get_sample_target(self, sample_index: int) -> str:
        """Get target output for a specific sample"""
        return self.targets[sample_index]
    
    def postProcess(
        self, 
        out_tokens: List[List[int]], 
        query_id_list: List[int] = None,
        sample_index_list: List[int] = None
    ) -> List[np.ndarray]:
        """Post-process output tokens for MLPerf compliance"""
        if query_id_list is not None:
            assert len(query_id_list) == len(out_tokens)
        
        return [np.asarray(out, dtype=np.int32) for out in out_tokens]
    
    def LoadSamplesToRam(self, sample_list: List[int]):
        """Load samples to RAM (optional optimization)"""
        # For now, all samples are already in RAM
        pass
    
    def UnloadSamplesFromRam(self, sample_list: List[int]):
        """Unload samples from RAM (optional optimization)"""
        # For now, samples remain in RAM
        pass


class MLPerfQuerySampleLibrary:
    """MLPerf Query Sample Library implementation"""
    
    def __init__(self, dataset: MLPerfDataset):
        self.dataset = dataset
        self.qsl = lg.ConstructQSL(
            dataset.get_item_count(),
            dataset.perf_count,
            dataset.LoadSamplesToRam,
            dataset.UnloadSamplesFromRam
        )
        
        logger.info(f"Query Sample Library initialized with {dataset.get_item_count()} total samples")
        logger.info(f"Performance sample count: {dataset.perf_count}")
    
    def get_query_sample_library(self):
        """Return the MLPerf QuerySampleLibrary object"""
        return self.qsl
    
    def get_dataset(self) -> MLPerfDataset:
        """Return the underlying dataset"""
        return self.dataset


def create_mlperf_dataset(
    dataset_path: str = "./dataset/cnn_dailymail_v3.json",
    total_sample_count: int = 13368,
    perf_count_override: Optional[int] = None
) -> tuple[MLPerfDataset, MLPerfQuerySampleLibrary]:
    """Create MLPerf dataset and query sample library"""
    
    # Create dataset
    dataset = MLPerfDataset(
        dataset_path=dataset_path,
        total_sample_count=total_sample_count,
        perf_count_override=perf_count_override
    )
    
    # Create query sample library
    qsl = MLPerfQuerySampleLibrary(dataset)
    
    return dataset, qsl


if __name__ == "__main__":
    # Test the dataset loading
    dataset_path = "./dataset/cnn_dailymail_v3.json"
    
    if not os.path.exists(dataset_path):
        print(f"Dataset not found at {dataset_path}")
        print("Please run: python scripts/download-dataset.py")
        exit(1)
    
    # Test dataset creation
    dataset, qsl = create_mlperf_dataset(dataset_path)
    
    # Print some statistics
    print(f"Dataset statistics:")
    print(f"  Total samples: {dataset.get_item_count()}")
    print(f"  Performance samples: {dataset.perf_count}")
    print(f"  Average input length: {sum(dataset.input_lens) / len(dataset.input_lens):.1f}")
    print(f"  Max input length: {max(dataset.input_lens)}")
    
    # Test a sample
    sample_text = dataset.get_sample_input_text(0)
    sample_target = dataset.get_sample_target(0)
    print(f"\nSample 0:")
    print(f"  Input length: {len(sample_text)} chars")
    print(f"  Target length: {len(sample_target)} chars")
    print(f"  Input preview: {sample_text[:200]}...")
    print(f"  Target preview: {sample_target[:100]}...")