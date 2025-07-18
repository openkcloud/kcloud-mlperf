#!/usr/bin/env python3
"""
Universal Environment Detector for MLPerf Benchmarks
Automatically detects and configures for different hardware environments
"""

import os
import sys
import json
import subprocess
import platform
import logging
from pathlib import Path
from typing import Dict, List, Any, Optional
from dataclasses import dataclass, asdict

logger = logging.getLogger(__name__)

@dataclass
class AcceleratorInfo:
    """Information about detected accelerators"""
    type: str  # 'gpu', 'npu', 'cpu'
    vendor: str  # 'nvidia', 'furiosa', 'intel', 'amd', etc.
    model: str
    memory_gb: float
    device_id: str
    driver_version: str = ""
    compute_capability: str = ""

@dataclass
class SystemInfo:
    """Complete system information"""
    hostname: str
    platform: str
    cpu_count: int
    memory_gb: float
    accelerators: List[AcceleratorInfo]
    container_runtime: str
    kubernetes_available: bool
    docker_available: bool

class UniversalEnvironmentDetector:
    """Detects hardware and software environment automatically"""
    
    def __init__(self):
        self.system_info = None
        self._setup_logging()
    
    def _setup_logging(self):
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(levelname)s - %(message)s'
        )
    
    def detect_environment(self) -> SystemInfo:
        """Detect complete system environment"""
        logger.info("🔍 Detecting system environment...")
        
        hostname = platform.node()
        system_platform = platform.system()
        cpu_count = os.cpu_count()
        memory_gb = self._get_memory_info()
        
        accelerators = self._detect_accelerators()
        container_runtime = self._detect_container_runtime()
        k8s_available = self._check_kubernetes()
        docker_available = self._check_docker()
        
        self.system_info = SystemInfo(
            hostname=hostname,
            platform=system_platform,
            cpu_count=cpu_count,
            memory_gb=memory_gb,
            accelerators=accelerators,
            container_runtime=container_runtime,
            kubernetes_available=k8s_available,
            docker_available=docker_available
        )
        
        self._log_environment()
        return self.system_info
    
    def _get_memory_info(self) -> float:
        """Get system memory in GB"""
        try:
            with open('/proc/meminfo', 'r') as f:
                for line in f:
                    if line.startswith('MemTotal:'):
                        # Convert KB to GB
                        return int(line.split()[1]) / 1024 / 1024
        except:
            return 0.0
        return 0.0
    
    def _detect_accelerators(self) -> List[AcceleratorInfo]:
        """Detect all available accelerators"""
        accelerators = []
        
        # Detect NVIDIA GPUs
        accelerators.extend(self._detect_nvidia_gpus())
        
        # Detect Furiosa NPUs
        accelerators.extend(self._detect_furiosa_npus())
        
        # Detect Intel accelerators
        accelerators.extend(self._detect_intel_accelerators())
        
        # Detect AMD GPUs
        accelerators.extend(self._detect_amd_gpus())
        
        # If no accelerators found, add CPU
        if not accelerators:
            accelerators.append(AcceleratorInfo(
                type="cpu",
                vendor="cpu",
                model=platform.processor() or "Unknown CPU",
                memory_gb=self._get_memory_info(),
                device_id="cpu"
            ))
        
        return accelerators
    
    def _detect_nvidia_gpus(self) -> List[AcceleratorInfo]:
        """Detect NVIDIA GPUs"""
        gpus = []
        try:
            result = subprocess.run(['nvidia-smi', '--query-gpu=name,memory.total,driver_version,compute_cap', '--format=csv,noheader,nounits'], 
                                  capture_output=True, text=True, timeout=10)
            if result.returncode == 0:
                for i, line in enumerate(result.stdout.strip().split('\n')):
                    if line.strip():
                        parts = [p.strip() for p in line.split(',')]
                        if len(parts) >= 3:
                            gpus.append(AcceleratorInfo(
                                type="gpu",
                                vendor="nvidia",
                                model=parts[0],
                                memory_gb=float(parts[1]) / 1024,
                                device_id=f"cuda:{i}",
                                driver_version=parts[2] if len(parts) > 2 else "",
                                compute_capability=parts[3] if len(parts) > 3 else ""
                            ))
        except (subprocess.TimeoutExpired, FileNotFoundError, subprocess.SubprocessError):
            pass
        return gpus
    
    def _detect_furiosa_npus(self) -> List[AcceleratorInfo]:
        """Detect Furiosa NPUs"""
        npus = []
        try:
            # Try furiosa-smi command
            result = subprocess.run(['furiosa-smi'], capture_output=True, text=True, timeout=10)
            if result.returncode == 0:
                # Parse furiosa-smi output
                lines = result.stdout.strip().split('\n')
                for i, line in enumerate(lines):
                    if 'warboy' in line.lower() or 'rngd' in line.lower():
                        npus.append(AcceleratorInfo(
                            type="npu",
                            vendor="furiosa",
                            model="Furiosa Warboy",
                            memory_gb=32.0,  # Typical Furiosa NPU memory
                            device_id=f"npu:{i}",
                            driver_version="furiosa-runtime"
                        ))
        except (subprocess.TimeoutExpired, FileNotFoundError, subprocess.SubprocessError):
            pass
        
        # Also check for /dev/npu* devices
        try:
            npu_devices = list(Path('/dev').glob('npu*'))
            if npu_devices and not npus:  # If devices exist but smi failed
                for i, device in enumerate(npu_devices):
                    npus.append(AcceleratorInfo(
                        type="npu",
                        vendor="furiosa",
                        model="Furiosa NPU",
                        memory_gb=32.0,
                        device_id=f"npu:{i}",
                        driver_version="unknown"
                    ))
        except:
            pass
        
        return npus
    
    def _detect_intel_accelerators(self) -> List[AcceleratorInfo]:
        """Detect Intel accelerators (GPUs, Gaudi, etc.)"""
        accelerators = []
        try:
            # Check for Intel GPUs
            result = subprocess.run(['intel_gpu_top', '-l'], capture_output=True, text=True, timeout=5)
            if result.returncode == 0:
                lines = result.stdout.strip().split('\n')
                for i, line in enumerate(lines[1:]):  # Skip header
                    if line.strip():
                        accelerators.append(AcceleratorInfo(
                            type="gpu",
                            vendor="intel",
                            model="Intel GPU",
                            memory_gb=8.0,  # Estimate
                            device_id=f"intel:{i}"
                        ))
        except (subprocess.TimeoutExpired, FileNotFoundError, subprocess.SubprocessError):
            pass
        
        # Check for Intel Gaudi (Habana)
        try:
            if Path('/dev/accel').exists():
                gaudi_devices = list(Path('/dev').glob('accel*'))
                for i, device in enumerate(gaudi_devices):
                    accelerators.append(AcceleratorInfo(
                        type="npu",
                        vendor="intel",
                        model="Intel Gaudi",
                        memory_gb=96.0,  # Gaudi2 has 96GB HBM
                        device_id=f"gaudi:{i}"
                    ))
        except:
            pass
        
        return accelerators
    
    def _detect_amd_gpus(self) -> List[AcceleratorInfo]:
        """Detect AMD GPUs"""
        gpus = []
        try:
            result = subprocess.run(['rocm-smi', '--showproductname', '--showmeminfo', 'vram'], 
                                  capture_output=True, text=True, timeout=10)
            if result.returncode == 0:
                # Parse rocm-smi output
                lines = result.stdout.strip().split('\n')
                gpu_count = 0
                for line in lines:
                    if 'GPU' in line and ('MI' in line or 'RX' in line):
                        gpus.append(AcceleratorInfo(
                            type="gpu",
                            vendor="amd",
                            model=line.strip(),
                            memory_gb=16.0,  # Estimate
                            device_id=f"rocm:{gpu_count}"
                        ))
                        gpu_count += 1
        except (subprocess.TimeoutExpired, FileNotFoundError, subprocess.SubprocessError):
            pass
        return gpus
    
    def _detect_container_runtime(self) -> str:
        """Detect available container runtime"""
        runtimes = []
        
        try:
            subprocess.run(['docker', '--version'], capture_output=True, check=True, timeout=5)
            runtimes.append('docker')
        except:
            pass
        
        try:
            subprocess.run(['podman', '--version'], capture_output=True, check=True, timeout=5)
            runtimes.append('podman')
        except:
            pass
        
        try:
            subprocess.run(['containerd', '--version'], capture_output=True, check=True, timeout=5)
            runtimes.append('containerd')
        except:
            pass
        
        return ','.join(runtimes) if runtimes else 'none'
    
    def _check_kubernetes(self) -> bool:
        """Check if Kubernetes is available"""
        try:
            result = subprocess.run(['kubectl', 'version', '--client'], 
                                  capture_output=True, timeout=5)
            return result.returncode == 0
        except:
            return False
    
    def _check_docker(self) -> bool:
        """Check if Docker is available and running"""
        try:
            result = subprocess.run(['docker', 'ps'], capture_output=True, timeout=5)
            return result.returncode == 0
        except:
            return False
    
    def _log_environment(self):
        """Log detected environment"""
        if not self.system_info:
            return
        
        logger.info(f"🖥️  System: {self.system_info.hostname} ({self.system_info.platform})")
        logger.info(f"💾 Memory: {self.system_info.memory_gb:.1f}GB, CPUs: {self.system_info.cpu_count}")
        logger.info(f"🔧 Container Runtime: {self.system_info.container_runtime}")
        logger.info(f"☸️  Kubernetes: {'✅' if self.system_info.kubernetes_available else '❌'}")
        logger.info(f"🐳 Docker: {'✅' if self.system_info.docker_available else '❌'}")
        
        if self.system_info.accelerators:
            logger.info(f"🚀 Accelerators detected:")
            for i, acc in enumerate(self.system_info.accelerators):
                logger.info(f"   {i+1}. {acc.vendor.upper()} {acc.model} ({acc.memory_gb:.1f}GB) - {acc.device_id}")
        else:
            logger.info("⚠️  No accelerators detected, using CPU")
    
    def save_environment_config(self, config_path: str = "environment_config.json"):
        """Save environment configuration to file"""
        if not self.system_info:
            self.detect_environment()
        
        config = {
            "system_info": asdict(self.system_info),
            "mlperf_config": self.generate_mlperf_config(),
            "deployment_config": self.generate_deployment_config()
        }
        
        with open(config_path, 'w') as f:
            json.dump(config, f, indent=2)
        
        logger.info(f"💾 Environment config saved to {config_path}")
        return config_path
    
    def generate_mlperf_config(self) -> Dict[str, Any]:
        """Generate MLPerf configuration based on detected environment"""
        if not self.system_info:
            return {}
        
        # Base configuration
        config = {
            "model_name": "meta-llama/Llama-3.1-8B-Instruct",
            "max_tokens": 64,
            "batch_size": 1,
            "scenarios": ["Server", "Offline"],
            "min_duration_ms": 60000,
            "min_query_count": 100,
            "accuracy_target": 0.99
        }
        
        # Adjust based on accelerators
        if self.system_info.accelerators:
            primary_acc = self.system_info.accelerators[0]
            
            if primary_acc.vendor == "nvidia":
                config.update({
                    "device": "cuda",
                    "torch_dtype": "float16",
                    "server_target_qps": min(len([a for a in self.system_info.accelerators if a.type == "gpu"]) * 1.0, 4.0),
                    "offline_target_qps": min(len([a for a in self.system_info.accelerators if a.type == "gpu"]) * 10.0, 40.0)
                })
            elif primary_acc.vendor == "furiosa":
                config.update({
                    "device": "npu",
                    "framework": "furiosa",
                    "server_target_qps": min(len([a for a in self.system_info.accelerators if a.type == "npu"]) * 2.0, 8.0),
                    "offline_target_qps": min(len([a for a in self.system_info.accelerators if a.type == "npu"]) * 15.0, 60.0)
                })
            elif primary_acc.vendor == "amd":
                config.update({
                    "device": "rocm",
                    "torch_dtype": "float16",
                    "server_target_qps": min(len([a for a in self.system_info.accelerators if a.type == "gpu"]) * 0.8, 3.2),
                    "offline_target_qps": min(len([a for a in self.system_info.accelerators if a.type == "gpu"]) * 8.0, 32.0)
                })
            elif primary_acc.vendor == "intel":
                config.update({
                    "device": "intel",
                    "server_target_qps": min(len(self.system_info.accelerators) * 1.5, 6.0),
                    "offline_target_qps": min(len(self.system_info.accelerators) * 12.0, 48.0)
                })
            else:  # CPU fallback
                config.update({
                    "device": "cpu",
                    "torch_dtype": "float32",
                    "server_target_qps": 0.1,
                    "offline_target_qps": 0.5,
                    "batch_size": min(self.system_info.cpu_count // 4, 4)
                })
        
        return config
    
    def generate_deployment_config(self) -> Dict[str, Any]:
        """Generate deployment configuration"""
        if not self.system_info:
            return {}
        
        config = {
            "deployment_type": "auto",
            "container_runtime": "docker" if self.system_info.docker_available else "none",
            "orchestrator": "kubernetes" if self.system_info.kubernetes_available else "standalone",
            "multi_node": len(self.system_info.accelerators) > 1,
            "resource_requirements": {
                "memory": f"{max(32, self.system_info.memory_gb * 0.8):.0f}Gi",
                "cpu": f"{max(4, self.system_info.cpu_count // 2)}",
                "accelerators": len(self.system_info.accelerators)
            }
        }
        
        # Add specific requirements based on accelerator type
        if self.system_info.accelerators:
            primary_acc = self.system_info.accelerators[0]
            if primary_acc.vendor == "nvidia":
                config["gpu_runtime"] = "nvidia"
                config["cuda_version"] = "12.1"
            elif primary_acc.vendor == "furiosa":
                config["npu_runtime"] = "furiosa"
                config["furiosa_version"] = "latest"
            elif primary_acc.vendor == "amd":
                config["gpu_runtime"] = "rocm"
                config["rocm_version"] = "5.7"
        
        return config

def main():
    """Main entry point for environment detection"""
    detector = UniversalEnvironmentDetector()
    system_info = detector.detect_environment()
    config_path = detector.save_environment_config()
    
    print("\n" + "="*60)
    print("🎯 ENVIRONMENT DETECTION COMPLETE")
    print("="*60)
    print(f"📊 Configuration saved to: {config_path}")
    print(f"🚀 Ready for MLPerf benchmark deployment!")
    
    return system_info

if __name__ == "__main__":
    main()