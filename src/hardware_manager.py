#!/usr/bin/env python3
"""
Dynamic Hardware Manager for MLPerf Benchmarks
Intelligently manages transitions between different hardware configurations
"""

import os
import json
import yaml
import logging
import subprocess
import shutil
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass, asdict
from environment_detector import UniversalEnvironmentDetector, SystemInfo

logger = logging.getLogger(__name__)

@dataclass
class HardwareConfiguration:
    """Configuration for a specific hardware setup"""
    name: str
    description: str
    accelerator_types: List[str]  # ['nvidia', 'furiosa']
    nodes: List[Dict[str, Any]]
    config_template: str
    deployment_type: str  # 'kubernetes', 'docker', 'standalone'
    performance_profile: Dict[str, float]  # Expected performance metrics
    
class HardwareManager:
    """Manages dynamic hardware configuration switching"""
    
    def __init__(self, config_dir: str = "./configs"):
        self.config_dir = Path(config_dir)
        self.detector = UniversalEnvironmentDetector()
        self.current_config: Optional[HardwareConfiguration] = None
        self.available_configs: Dict[str, HardwareConfiguration] = {}
        self._setup_logging()
        self._load_configurations()
    
    def _setup_logging(self):
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
        )
    
    def _load_configurations(self):
        """Load available hardware configurations"""
        
        # Define predefined configurations
        self.available_configs = {
            "nvidia-only": HardwareConfiguration(
                name="nvidia-only",
                description="NVIDIA GPU cluster (your current jw2/jw3 setup)",
                accelerator_types=["nvidia"],
                nodes=[
                    {"hostname": "jw2", "ip": "129.254.202.252", "gpus": 1},
                    {"hostname": "jw3", "ip": "129.254.202.253", "gpus": 1}
                ],
                config_template="nvidia-multi-gpu.yaml",
                deployment_type="kubernetes",
                performance_profile={"expected_qps": 2.05, "scaling_factor": 1.0}
            ),
            
            "furiosa-only": HardwareConfiguration(
                name="furiosa-only", 
                description="Furiosa Warboy NPU setup",
                accelerator_types=["furiosa"],
                nodes=[
                    {"hostname": "auto", "npus": 1}
                ],
                config_template="furiosa-cluster.yaml",
                deployment_type="kubernetes",
                performance_profile={"expected_qps": 2.0, "scaling_factor": 1.2}
            ),
            
            "hybrid-gpu-npu": HardwareConfiguration(
                name="hybrid-gpu-npu",
                description="Mixed NVIDIA GPU + Furiosa NPU cluster",
                accelerator_types=["nvidia", "furiosa"],
                nodes=[
                    {"hostname": "jw2", "ip": "129.254.202.252", "gpus": 1},
                    {"hostname": "jw3", "ip": "129.254.202.253", "gpus": 1},
                    {"hostname": "auto", "npus": 1}
                ],
                config_template="hybrid-gpu-npu.yaml",
                deployment_type="kubernetes", 
                performance_profile={"expected_qps": 4.05, "scaling_factor": 1.8}
            ),
            
            "development": HardwareConfiguration(
                name="development",
                description="CPU-only development environment",
                accelerator_types=["cpu"],
                nodes=[
                    {"hostname": "localhost", "cpus": 8}
                ],
                config_template="single-node.yaml",
                deployment_type="standalone",
                performance_profile={"expected_qps": 0.1, "scaling_factor": 0.1}
            )
        }
        
        logger.info(f"📚 Loaded {len(self.available_configs)} hardware configurations")
    
    def detect_optimal_configuration(self) -> str:
        """Detect the optimal configuration for current hardware"""
        
        logger.info("🔍 Detecting optimal hardware configuration...")
        
        # Run environment detection
        system_info = self.detector.detect_environment()
        
        if not system_info or not system_info.accelerators:
            logger.warning("No accelerators detected, falling back to development mode")
            return "development"
        
        # Analyze detected accelerators
        accelerator_types = set(acc.vendor for acc in system_info.accelerators)
        
        # Check for hybrid setup
        if "nvidia" in accelerator_types and "furiosa" in accelerator_types:
            logger.info("🎯 Detected hybrid GPU+NPU setup")
            return "hybrid-gpu-npu"
        
        # Check for single accelerator type
        elif "nvidia" in accelerator_types:
            nvidia_count = sum(1 for acc in system_info.accelerators if acc.vendor == "nvidia")
            if nvidia_count >= 2:
                logger.info("🎯 Detected multi-GPU NVIDIA setup")
                return "nvidia-only"
            else:
                logger.info("🎯 Detected single NVIDIA GPU")
                return "nvidia-only"  # Can still use the same config
        
        elif "furiosa" in accelerator_types:
            logger.info("🎯 Detected Furiosa NPU setup")
            return "furiosa-only"
        
        else:
            logger.info("🎯 No known accelerators, using development config")
            return "development"
    
    def switch_configuration(self, config_name: str, dry_run: bool = False) -> bool:
        """Switch to a different hardware configuration"""
        
        if config_name not in self.available_configs:
            logger.error(f"❌ Unknown configuration: {config_name}")
            return False
        
        config = self.available_configs[config_name]
        logger.info(f"🔄 Switching to configuration: {config.name}")
        logger.info(f"   Description: {config.description}")
        
        if dry_run:
            logger.info("🧪 DRY RUN MODE - No actual changes will be made")
            return self._validate_configuration(config)
        
        try:
            # Cleanup current deployment if exists
            if self.current_config:
                self._cleanup_current_deployment()
            
            # Deploy new configuration
            success = self._deploy_configuration(config)
            
            if success:
                self.current_config = config
                self._save_current_config()
                logger.info(f"✅ Successfully switched to {config.name}")
                return True
            else:
                logger.error(f"❌ Failed to switch to {config.name}")
                return False
                
        except Exception as e:
            logger.error(f"❌ Error switching configuration: {e}")
            return False
    
    def _validate_configuration(self, config: HardwareConfiguration) -> bool:
        """Validate if configuration can be deployed"""
        
        logger.info(f"✅ Validating configuration: {config.name}")
        
        # Check if required accelerators are available
        system_info = self.detector.detect_environment()
        if not system_info:
            logger.error("Cannot detect system information")
            return False
        
        available_accelerators = set(acc.vendor for acc in system_info.accelerators)
        
        for required_acc in config.accelerator_types:
            if required_acc == "cpu":
                continue  # CPU always available
                
            if required_acc not in available_accelerators:
                logger.warning(f"⚠️ Required accelerator {required_acc} not detected")
                return False
        
        # Check if config template exists
        template_path = self.config_dir / config.config_template
        if not template_path.exists():
            logger.warning(f"⚠️ Config template not found: {template_path}")
            return False
        
        # Check deployment environment
        if config.deployment_type == "kubernetes":
            try:
                result = subprocess.run(["kubectl", "version", "--client"], 
                                      capture_output=True, text=True)
                if result.returncode != 0:
                    logger.warning("⚠️ kubectl not available for Kubernetes deployment")
                    return False
            except FileNotFoundError:
                logger.warning("⚠️ kubectl not found in PATH")
                return False
        
        elif config.deployment_type == "docker":
            try:
                result = subprocess.run(["docker", "version"], 
                                      capture_output=True, text=True)
                if result.returncode != 0:
                    logger.warning("⚠️ Docker not available")
                    return False
            except FileNotFoundError:
                logger.warning("⚠️ docker not found in PATH")
                return False
        
        logger.info("✅ Configuration validation passed")
        return True
    
    def _deploy_configuration(self, config: HardwareConfiguration) -> bool:
        """Deploy the specified configuration"""
        
        template_path = self.config_dir / config.config_template
        
        if config.deployment_type == "kubernetes":
            return self._deploy_kubernetes(template_path)
        elif config.deployment_type == "docker":
            return self._deploy_docker(config)
        elif config.deployment_type == "standalone":
            return self._deploy_standalone(config)
        else:
            logger.error(f"Unknown deployment type: {config.deployment_type}")
            return False
    
    def _deploy_kubernetes(self, template_path: Path) -> bool:
        """Deploy using Kubernetes"""
        try:
            cmd = ["kubectl", "apply", "-f", str(template_path)]
            result = subprocess.run(cmd, capture_output=True, text=True)
            
            if result.returncode == 0:
                logger.info("✅ Kubernetes deployment successful")
                return True
            else:
                logger.error(f"❌ Kubernetes deployment failed: {result.stderr}")
                return False
                
        except Exception as e:
            logger.error(f"❌ Kubernetes deployment error: {e}")
            return False
    
    def _deploy_docker(self, config: HardwareConfiguration) -> bool:
        """Deploy using Docker Compose"""
        try:
            # Determine the profile to use
            profile = config.accelerator_types[0] if config.accelerator_types else "cpu"
            
            cmd = ["docker-compose", "--profile", profile, "up", "-d"]
            result = subprocess.run(cmd, capture_output=True, text=True)
            
            if result.returncode == 0:
                logger.info("✅ Docker deployment successful")
                return True
            else:
                logger.error(f"❌ Docker deployment failed: {result.stderr}")
                return False
                
        except Exception as e:
            logger.error(f"❌ Docker deployment error: {e}")
            return False
    
    def _deploy_standalone(self, config: HardwareConfiguration) -> bool:
        """Deploy as standalone process"""
        try:
            # For standalone, we just update the configuration
            # The actual benchmark will be run separately
            logger.info("✅ Standalone configuration ready")
            return True
            
        except Exception as e:
            logger.error(f"❌ Standalone setup error: {e}")
            return False
    
    def _cleanup_current_deployment(self):
        """Cleanup current deployment"""
        if not self.current_config:
            return
        
        logger.info(f"🧹 Cleaning up {self.current_config.name} deployment")
        
        try:
            if self.current_config.deployment_type == "kubernetes":
                # Try to delete the namespace or specific resources
                namespace = "mlperf" if "hybrid" in self.current_config.name else "default"
                subprocess.run(["kubectl", "delete", "namespace", namespace, "--ignore-not-found"], 
                             capture_output=True)
            
            elif self.current_config.deployment_type == "docker":
                subprocess.run(["docker-compose", "down"], capture_output=True)
            
        except Exception as e:
            logger.warning(f"⚠️ Cleanup warning: {e}")
    
    def _save_current_config(self):
        """Save current configuration to file"""
        if not self.current_config:
            return
        
        config_file = Path("./current_hardware_config.json")
        try:
            with open(config_file, 'w') as f:
                json.dump(asdict(self.current_config), f, indent=2)
            logger.info(f"💾 Saved current config to {config_file}")
        except Exception as e:
            logger.warning(f"⚠️ Could not save config: {e}")
    
    def get_status(self) -> Dict[str, Any]:
        """Get current hardware and configuration status"""
        
        # Detect current hardware
        system_info = self.detector.detect_environment()
        
        # Get current configuration
        current_config_name = self.current_config.name if self.current_config else "none"
        
        # Check deployment status
        deployment_status = self._check_deployment_status()
        
        status = {
            "timestamp": str(subprocess.run(["date"], capture_output=True, text=True).stdout.strip()),
            "current_configuration": current_config_name,
            "detected_hardware": {
                "accelerators": [
                    {
                        "vendor": acc.vendor,
                        "model": acc.model,
                        "memory_gb": acc.memory_gb
                    }
                    for acc in (system_info.accelerators if system_info else [])
                ],
                "cpu_count": system_info.cpu_count if system_info else 0,
                "memory_gb": system_info.memory_gb if system_info else 0
            },
            "available_configurations": list(self.available_configs.keys()),
            "deployment_status": deployment_status,
            "recommended_config": self.detect_optimal_configuration()
        }
        
        return status
    
    def _check_deployment_status(self) -> Dict[str, Any]:
        """Check status of current deployment"""
        status = {"kubernetes": False, "docker": False, "processes": []}
        
        try:
            # Check Kubernetes
            result = subprocess.run(["kubectl", "get", "pods", "-A"], 
                                  capture_output=True, text=True)
            if result.returncode == 0 and "mlperf" in result.stdout:
                status["kubernetes"] = True
        except:
            pass
        
        try:
            # Check Docker
            result = subprocess.run(["docker", "ps"], capture_output=True, text=True)
            if result.returncode == 0 and "mlperf" in result.stdout:
                status["docker"] = True
        except:
            pass
        
        return status

def main():
    import argparse
    
    parser = argparse.ArgumentParser(description="Hardware configuration manager")
    parser.add_argument("--status", action="store_true", 
                       help="Show current hardware status")
    parser.add_argument("--detect", action="store_true",
                       help="Detect optimal configuration")
    parser.add_argument("--switch", type=str,
                       help="Switch to specified configuration")
    parser.add_argument("--list", action="store_true",
                       help="List available configurations")
    parser.add_argument("--dry-run", action="store_true",
                       help="Validate configuration without deploying")
    
    args = parser.parse_args()
    
    manager = HardwareManager()
    
    if args.status:
        status = manager.get_status()
        print("🖥️ Hardware Status:")
        print(json.dumps(status, indent=2))
    
    elif args.detect:
        optimal = manager.detect_optimal_configuration()
        print(f"🎯 Recommended configuration: {optimal}")
        
        config = manager.available_configs[optimal]
        print(f"   Description: {config.description}")
        print(f"   Expected QPS: {config.performance_profile['expected_qps']}")
    
    elif args.list:
        print("📋 Available configurations:")
        for name, config in manager.available_configs.items():
            print(f"  • {name}: {config.description}")
    
    elif args.switch:
        success = manager.switch_configuration(args.switch, dry_run=args.dry_run)
        if success:
            print(f"✅ Configuration switch successful")
        else:
            print(f"❌ Configuration switch failed")
    
    else:
        # Auto-detect and suggest
        optimal = manager.detect_optimal_configuration()
        print(f"🎯 Detected optimal configuration: {optimal}")
        print(f"   Run with --switch {optimal} to apply this configuration")

if __name__ == "__main__":
    main()