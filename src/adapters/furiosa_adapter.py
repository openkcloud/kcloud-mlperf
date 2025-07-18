#!/usr/bin/env python3
"""
Furiosa NPU Adapter for MLPerf Benchmarks
Provides seamless integration with Furiosa Warboy NPUs
"""

import os
import sys
import time
import logging
from typing import Dict, Any, List, Optional
from pathlib import Path

# Try to import Furiosa SDK components
try:
    import furiosa.runtime as fr
    import furiosa.runtime.sync as frs
    from furiosa.common.thread import synchronize
    from furiosa.runtime.errors import DeviceError, CompilerError
    FURIOSA_AVAILABLE = True
except ImportError:
    FURIOSA_AVAILABLE = False
    fr = None
    frs = None

logger = logging.getLogger(__name__)

class FuriosaMLPerfAdapter:
    """Adapter for running MLPerf benchmarks on Furiosa NPUs"""
    
    def __init__(self, model_path: Optional[str] = None, device_id: int = 0):
        self.model_path = model_path
        self.device_id = device_id
        self.session = None
        self.model_info = None
        self.device_info = None
        
        if not FURIOSA_AVAILABLE:
            raise ImportError(
                "Furiosa SDK not available. Install with: "
                "pip install furiosa-sdk[runtime,quantizer,common]"
            )
        
        self._initialize_device()
    
    def _initialize_device(self):
        """Initialize Furiosa NPU device"""
        try:
            # Check available devices
            devices = frs.list_devices()
            if not devices:
                raise RuntimeError("No Furiosa NPU devices found")
            
            if self.device_id >= len(devices):
                raise RuntimeError(f"Device {self.device_id} not found. Available: {len(devices)}")
            
            self.device_info = devices[self.device_id]
            logger.info(f"🚀 Initialized Furiosa NPU: {self.device_info}")
            
        except Exception as e:
            logger.error(f"Failed to initialize Furiosa NPU: {e}")
            raise
    
    def load_model(self, model_path: str, **kwargs) -> None:
        """Load model onto Furiosa NPU"""
        if not Path(model_path).exists():
            raise FileNotFoundError(f"Model file not found: {model_path}")
        
        try:
            logger.info(f"📥 Loading model: {model_path}")
            start_time = time.time()
            
            # Create session
            self.session = frs.create_session(
                model_path, 
                device=f"npu:{self.device_id}",
                **kwargs
            )
            
            # Get model information
            self.model_info = self.session.model
            
            load_time = time.time() - start_time
            logger.info(f"✅ Model loaded in {load_time:.2f}s")
            logger.info(f"📊 Model info: {self.model_info}")
            
        except Exception as e:
            logger.error(f"Failed to load model: {e}")
            raise
    
    def prepare_input(self, input_data: Any, **kwargs) -> Any:
        """Prepare input data for Furiosa NPU"""
        try:
            # Convert input to appropriate format for Furiosa
            # This will depend on the specific model format and requirements
            
            if isinstance(input_data, str):
                # Text input - would need tokenization
                # This is a placeholder for text-to-NPU conversion
                logger.warning("Text input conversion not yet implemented for Furiosa NPU")
                return input_data
            
            # For numeric inputs, ensure proper format
            import numpy as np
            if isinstance(input_data, (list, tuple)):
                input_data = np.array(input_data)
            
            if hasattr(input_data, 'numpy'):  # PyTorch tensor
                input_data = input_data.cpu().numpy()
            
            return input_data
            
        except Exception as e:
            logger.error(f"Failed to prepare input: {e}")
            raise
    
    def run_inference(self, input_data: Any, **kwargs) -> Any:
        """Run inference on Furiosa NPU"""
        if not self.session:
            raise RuntimeError("Model not loaded. Call load_model() first.")
        
        try:
            # Prepare input
            prepared_input = self.prepare_input(input_data, **kwargs)
            
            # Run inference
            start_time = time.time()
            outputs = self.session.run(prepared_input)
            inference_time = time.time() - start_time
            
            logger.debug(f"Inference completed in {inference_time*1000:.2f}ms")
            
            return {
                'outputs': outputs,
                'inference_time_ms': inference_time * 1000,
                'device': f"npu:{self.device_id}"
            }
            
        except Exception as e:
            logger.error(f"Inference failed: {e}")
            raise
    
    def batch_inference(self, input_batch: List[Any], **kwargs) -> List[Any]:
        """Run batch inference on Furiosa NPU"""
        results = []
        
        for i, input_data in enumerate(input_batch):
            try:
                result = self.run_inference(input_data, **kwargs)
                results.append(result)
            except Exception as e:
                logger.error(f"Batch inference failed for item {i}: {e}")
                results.append({
                    'error': str(e),
                    'inference_time_ms': 0,
                    'device': f"npu:{self.device_id}"
                })
        
        return results
    
    def get_device_info(self) -> Dict[str, Any]:
        """Get Furiosa NPU device information"""
        try:
            device_status = frs.device_status(self.device_id)
            
            return {
                'device_id': self.device_id,
                'device_type': 'npu',
                'vendor': 'furiosa',
                'model': 'Warboy',
                'status': device_status,
                'memory_info': self._get_memory_info(),
                'temperature': self._get_temperature(),
                'utilization': self._get_utilization()
            }
        except Exception as e:
            logger.warning(f"Could not get device info: {e}")
            return {
                'device_id': self.device_id,
                'device_type': 'npu',
                'vendor': 'furiosa',
                'error': str(e)
            }
    
    def _get_memory_info(self) -> Dict[str, float]:
        """Get NPU memory information"""
        try:
            # This would use Furiosa SDK memory monitoring
            # Placeholder implementation
            return {
                'total_gb': 32.0,  # Typical Furiosa NPU memory
                'used_gb': 0.0,
                'free_gb': 32.0
            }
        except:
            return {'total_gb': 32.0, 'used_gb': 0.0, 'free_gb': 32.0}
    
    def _get_temperature(self) -> float:
        """Get NPU temperature"""
        try:
            # Placeholder - would use Furiosa monitoring APIs
            return 45.0  # Celsius
        except:
            return 0.0
    
    def _get_utilization(self) -> float:
        """Get NPU utilization percentage"""
        try:
            # Placeholder - would use Furiosa monitoring APIs
            return 0.0  # Percentage
        except:
            return 0.0
    
    def cleanup(self):
        """Clean up resources"""
        try:
            if self.session:
                self.session.close()
                self.session = None
            logger.info("🧹 Furiosa NPU resources cleaned up")
        except Exception as e:
            logger.warning(f"Cleanup warning: {e}")

class FuriosaMLPerfBenchmark:
    """MLPerf benchmark implementation for Furiosa NPUs"""
    
    def __init__(self, model_path: str, device_id: int = 0):
        self.adapter = FuriosaMLPerfAdapter(device_id=device_id)
        self.model_path = model_path
        self.results = []
    
    def setup(self, **kwargs):
        """Setup benchmark environment"""
        logger.info("🔧 Setting up Furiosa NPU benchmark...")
        
        # Load model
        self.adapter.load_model(self.model_path, **kwargs)
        
        # Warmup
        self._warmup()
        
        logger.info("✅ Furiosa NPU benchmark setup complete")
    
    def _warmup(self, warmup_iterations: int = 5):
        """Warmup the NPU"""
        logger.info(f"🔥 Warming up NPU with {warmup_iterations} iterations...")
        
        # Create dummy input for warmup
        dummy_input = self._create_dummy_input()
        
        for i in range(warmup_iterations):
            try:
                self.adapter.run_inference(dummy_input)
            except Exception as e:
                logger.warning(f"Warmup iteration {i} failed: {e}")
        
        logger.info("✅ Warmup completed")
    
    def _create_dummy_input(self) -> Any:
        """Create dummy input for warmup"""
        # This would depend on the specific model requirements
        # Placeholder implementation
        import numpy as np
        return np.random.randn(1, 512).astype(np.float32)
    
    def run_server_scenario(self, queries: List[Any], target_qps: float = 2.0, duration_ms: int = 60000) -> Dict[str, Any]:
        """Run MLPerf Server scenario on Furiosa NPU"""
        logger.info(f"🏃‍♂️ Running Server scenario (target QPS: {target_qps})")
        
        results = []
        start_time = time.time()
        query_count = 0
        
        while True:
            elapsed_ms = (time.time() - start_time) * 1000
            if elapsed_ms >= duration_ms:
                break
            
            query = queries[query_count % len(queries)]
            
            # Run inference
            try:
                result = self.adapter.run_inference(query)
                result['query_id'] = f"server_{query_count}"
                result['timestamp'] = time.time()
                results.append(result)
            except Exception as e:
                logger.error(f"Query {query_count} failed: {e}")
            
            query_count += 1
            
            # QPS pacing
            if target_qps > 0:
                time.sleep(1.0 / target_qps)
        
        return self._analyze_results("Server", results)
    
    def run_offline_scenario(self, queries: List[Any], duration_ms: int = 60000) -> Dict[str, Any]:
        """Run MLPerf Offline scenario on Furiosa NPU"""
        logger.info("🏃‍♂️ Running Offline scenario (maximum throughput)")
        
        results = []
        start_time = time.time()
        query_count = 0
        
        while True:
            elapsed_ms = (time.time() - start_time) * 1000
            if elapsed_ms >= duration_ms:
                break
            
            query = queries[query_count % len(queries)]
            
            try:
                result = self.adapter.run_inference(query)
                result['query_id'] = f"offline_{query_count}"
                result['timestamp'] = time.time()
                results.append(result)
            except Exception as e:
                logger.error(f"Query {query_count} failed: {e}")
            
            query_count += 1
            
            # Minimal delay for maximum throughput
            time.sleep(0.01)
        
        return self._analyze_results("Offline", results)
    
    def _analyze_results(self, scenario: str, results: List[Dict]) -> Dict[str, Any]:
        """Analyze benchmark results"""
        if not results:
            return {'scenario': scenario, 'error': 'No results'}
        
        successful_results = [r for r in results if 'error' not in r]
        
        if not successful_results:
            return {'scenario': scenario, 'error': 'No successful results'}
        
        # Calculate metrics
        latencies = [r['inference_time_ms'] for r in successful_results]
        
        first_timestamp = min(r['timestamp'] for r in results)
        last_timestamp = max(r['timestamp'] for r in results)
        duration_s = last_timestamp - first_timestamp
        
        achieved_qps = len(successful_results) / max(duration_s, 1)
        
        # Simple percentile calculation
        def percentile(data, p):
            sorted_data = sorted(data)
            index = int(len(sorted_data) * p / 100)
            return sorted_data[min(index, len(sorted_data) - 1)]
        
        return {
            'scenario': scenario,
            'device': f"npu:{self.adapter.device_id}",
            'achieved_qps': achieved_qps,
            'latency_p50': percentile(latencies, 50),
            'latency_p90': percentile(latencies, 90),
            'latency_p99': percentile(latencies, 99),
            'total_queries': len(results),
            'successful_queries': len(successful_results),
            'duration_s': duration_s,
            'accuracy': len(successful_results) / len(results)
        }
    
    def cleanup(self):
        """Clean up benchmark resources"""
        self.adapter.cleanup()

# Utility functions for easy integration

def check_furiosa_availability() -> bool:
    """Check if Furiosa NPUs are available"""
    if not FURIOSA_AVAILABLE:
        return False
    
    try:
        devices = frs.list_devices()
        return len(devices) > 0
    except:
        return False

def list_furiosa_devices() -> List[Dict[str, Any]]:
    """List available Furiosa NPU devices"""
    if not FURIOSA_AVAILABLE:
        return []
    
    try:
        devices = frs.list_devices()
        return [
            {
                'device_id': i,
                'device_info': str(device),
                'type': 'npu',
                'vendor': 'furiosa'
            }
            for i, device in enumerate(devices)
        ]
    except:
        return []

def create_furiosa_benchmark(model_path: str, device_id: int = 0) -> FuriosaMLPerfBenchmark:
    """Create a Furiosa NPU benchmark instance"""
    return FuriosaMLPerfBenchmark(model_path, device_id)

# Example usage
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    
    print("🔍 Checking Furiosa NPU availability...")
    
    if check_furiosa_availability():
        devices = list_furiosa_devices()
        print(f"✅ Found {len(devices)} Furiosa NPU device(s)")
        for device in devices:
            print(f"   - Device {device['device_id']}: {device['device_info']}")
    else:
        print("❌ No Furiosa NPUs found or SDK not available")
        print("   Install with: pip install furiosa-sdk[runtime,quantizer,common]")