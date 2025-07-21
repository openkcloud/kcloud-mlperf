#!/usr/bin/env python3
"""
Generic Hardware Adapter for MLPerf Benchmarks
Provides base functionality that can be extended for specific accelerators
"""

import os
import time
import logging
from abc import ABC, abstractmethod
from typing import Dict, List, Any, Optional, Tuple
import yaml

logger = logging.getLogger(__name__)

class BaseHardwareAdapter(ABC):
    """Base class for hardware-specific adapters"""
    
    def __init__(self, config_path: Optional[str] = None):
        self.config = self._load_config(config_path)
        self.device = None
        self.model = None
        self.tokenizer = None
        
    def _load_config(self, config_path: Optional[str]) -> Dict[str, Any]:
        """Load hardware-specific configuration"""
        if config_path and os.path.exists(config_path):
            with open(config_path, 'r') as f:
                return yaml.safe_load(f)
        return self._get_default_config()
    
    @abstractmethod
    def _get_default_config(self) -> Dict[str, Any]:
        """Return default configuration for this adapter"""
        pass
    
    @abstractmethod
    def initialize_device(self) -> bool:
        """Initialize the hardware device"""
        pass
    
    @abstractmethod
    def load_model(self, model_name: str) -> bool:
        """Load the model onto the device"""
        pass
    
    @abstractmethod
    def run_inference(self, prompt: str, max_tokens: int) -> Tuple[str, Dict[str, float]]:
        """Run inference and return result with metrics"""
        pass
    
    @abstractmethod
    def get_device_info(self) -> Dict[str, Any]:
        """Get device information and stats"""
        pass
    
    def cleanup(self):
        """Clean up resources"""
        pass

class GenericAdapter(BaseHardwareAdapter):
    """Generic adapter for CPU and basic GPU inference"""
    
    def _get_default_config(self) -> Dict[str, Any]:
        return {
            'hardware': {
                'type': 'generic',
                'memory_gb': 16
            },
            'benchmark': {
                'batch_size': 1,
                'max_tokens': 64
            },
            'optimization': {
                'precision': 'fp32'
            }
        }
    
    def initialize_device(self) -> bool:
        """Initialize generic device (CPU or CUDA if available)"""
        try:
            import torch
            if torch.cuda.is_available():
                self.device = torch.device('cuda:0')
                logger.info(f"Using CUDA device: {torch.cuda.get_device_name(0)}")
            else:
                self.device = torch.device('cpu')
                logger.info("Using CPU device")
            return True
        except Exception as e:
            logger.error(f"Failed to initialize device: {e}")
            return False
    
    def load_model(self, model_name: str) -> bool:
        """Load model with generic settings"""
        try:
            from transformers import AutoTokenizer, AutoModelForCausalLM
            import torch
            
            logger.info(f"Loading model: {model_name}")
            
            self.tokenizer = AutoTokenizer.from_pretrained(model_name)
            if self.tokenizer.pad_token is None:
                self.tokenizer.pad_token = self.tokenizer.eos_token
                
            # Load model with appropriate precision
            precision = self.config.get('optimization', {}).get('precision', 'fp32')
            dtype = torch.float16 if precision == 'fp16' else torch.float32
            
            self.model = AutoModelForCausalLM.from_pretrained(
                model_name,
                torch_dtype=dtype,
                device_map="auto" if self.device.type == 'cuda' else None,
                trust_remote_code=True
            )
            
            if self.device.type == 'cpu':
                self.model = self.model.to(self.device)
                
            logger.info("Model loaded successfully")
            return True
            
        except Exception as e:
            logger.error(f"Failed to load model: {e}")
            return False
    
    def run_inference(self, prompt: str, max_tokens: int) -> Tuple[str, Dict[str, float]]:
        """Run inference with timing metrics"""
        if not self.model or not self.tokenizer:
            raise RuntimeError("Model not loaded")
            
        start_time = time.time()
        
        try:
            # Tokenize input
            inputs = self.tokenizer(prompt, return_tensors="pt", padding=True)
            inputs = {k: v.to(self.device) for k, v in inputs.items()}
            
            input_length = inputs['input_ids'].shape[1]
            
            # Time to first token
            ttft_start = time.time()
            
            # Generate response
            with torch.no_grad():
                outputs = self.model.generate(
                    **inputs,
                    max_new_tokens=max_tokens,
                    do_sample=True,
                    temperature=0.7,
                    pad_token_id=self.tokenizer.eos_token_id,
                    return_dict_in_generate=True,
                    output_scores=True
                )
            
            ttft_end = time.time()
            
            # Decode response
            generated_tokens = outputs.sequences[0][input_length:]
            response = self.tokenizer.decode(generated_tokens, skip_special_tokens=True)
            
            end_time = time.time()
            
            # Calculate metrics
            total_time = (end_time - start_time) * 1000  # ms
            ttft = (ttft_end - ttft_start) * 1000  # ms
            output_tokens = len(generated_tokens)
            tpot = (end_time - ttft_end) * 1000 / max(output_tokens, 1)  # ms per token
            
            metrics = {
                'total_latency_ms': total_time,
                'ttft_ms': ttft,
                'tpot_ms': tpot,
                'input_tokens': input_length,
                'output_tokens': output_tokens,
                'tokens_per_sec': output_tokens / max((end_time - start_time), 0.001)
            }
            
            return response, metrics
            
        except Exception as e:
            logger.error(f"Inference failed: {e}")
            return "", {'error': str(e)}
    
    def get_device_info(self) -> Dict[str, Any]:
        """Get device information"""
        info = {
            'device_type': self.device.type if self.device else 'unknown',
            'hardware_type': self.config.get('hardware', {}).get('type', 'generic')
        }
        
        if self.device and self.device.type == 'cuda':
            try:
                import torch
                info.update({
                    'gpu_name': torch.cuda.get_device_name(0),
                    'gpu_memory_total': torch.cuda.get_device_properties(0).total_memory,
                    'gpu_memory_allocated': torch.cuda.memory_allocated(0),
                    'gpu_memory_cached': torch.cuda.memory_reserved(0)
                })
            except Exception as e:
                logger.warning(f"Could not get GPU info: {e}")
                
        return info