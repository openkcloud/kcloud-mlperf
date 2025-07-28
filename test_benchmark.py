#!/usr/bin/env python3
"""
Simple benchmark test to validate the updated configuration system
"""

import os
import sys
from pathlib import Path
from datetime import datetime

# Add current directory to path
sys.path.insert(0, str(Path(__file__).parent))

from config import config

def test_configuration():
    """Test the configuration system"""
    print("🔧 Testing Configuration System")
    print("=" * 50)
    
    print(f"✅ Project root: {config.project_root}")
    print(f"✅ Results directory: {config.results_dir}")
    print(f"✅ Logs directory: {config.logs_dir}")
    print(f"✅ Reports directory: {config.reports_dir}")
    print(f"✅ Model name: {config.model_name}")
    print(f"✅ HF Token set: {'Yes' if config.hf_token else 'No'}")
    print(f"✅ Max tokens: {config.max_tokens}")
    
    print("\\n🌐 Node Configuration:")
    for node_name, node_ip in config.nodes.items():
        print(f"   {node_name}: {node_ip}")
    
    return True

def test_paths():
    """Test path generation"""
    print("\\n📁 Testing Path Generation")
    print("=" * 50)
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    
    # Test results paths
    datacenter_path = config.get_results_path("datacenter", timestamp)
    coordinated_path = config.get_results_path("coordinated", timestamp)
    
    print(f"✅ Datacenter results: {datacenter_path}")
    print(f"✅ Coordinated results: {coordinated_path}")
    
    # Test log path
    log_path = config.get_log_path("test.log")
    print(f"✅ Log path: {log_path}")
    
    return True

def test_ssh_command():
    """Test SSH command generation"""
    print("\\n🔗 Testing SSH Command Generation")
    print("=" * 50)
    
    try:
        cmd = config.get_ssh_command("jw2", "hostname")
        print(f"✅ SSH command for jw2: {' '.join(cmd)}")
        
        cmd = config.get_ssh_command("jw3", "python --version")
        print(f"✅ SSH command for jw3: {' '.join(cmd)}")
        
        return True
    except Exception as e:
        print(f"❌ SSH command test failed: {e}")
        return False

def test_directory_creation():
    """Test directory creation"""
    print("\\n📂 Testing Directory Creation")
    print("=" * 50)
    
    test_results_dir = config.get_results_path("test", "20250101_120000")
    test_results_dir.mkdir(parents=True, exist_ok=True)
    
    if test_results_dir.exists():
        print(f"✅ Test results directory created: {test_results_dir}")
        
        # Create a test file
        test_file = test_results_dir / "test_results.json"
        test_data = {
            "test": True,
            "timestamp": "20250101_120000",
            "benchmark_type": "test",
            "status": "success"
        }
        
        import json
        with open(test_file, 'w') as f:
            json.dump(test_data, f, indent=2)
        
        print(f"✅ Test file created: {test_file}")
        return True
    else:
        print(f"❌ Failed to create test directory: {test_results_dir}")
        return False

def test_report_generation():
    """Test report generation system"""
    print("\\n📊 Testing Report Generation")
    print("=" * 50)
    
    try:
        from report_generator import MLPerfReportGenerator
        
        generator = MLPerfReportGenerator()
        print(f"✅ Report generator initialized")
        print(f"✅ Report directory: {generator.report_dir}")
        
        # Test collecting results (should work even with no real results)
        all_results = generator.collect_all_results()
        print(f"✅ Results collection successful")
        print(f"   Found benchmark types: {list(all_results.keys())}")
        
        return True
    except Exception as e:
        print(f"❌ Report generation test failed: {e}")
        return False

def main():
    """Run all tests"""
    print("🎯 MLPerf Configuration and System Test")
    print("=" * 60)
    
    # Set environment variable if not set
    if not os.environ.get('HF_TOKEN'):
        os.environ['HF_TOKEN'] = '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'
    
    tests = [
        ("Configuration", test_configuration),
        ("Paths", test_paths),
        ("SSH Commands", test_ssh_command),
        ("Directory Creation", test_directory_creation),
        ("Report Generation", test_report_generation)
    ]
    
    passed = 0
    total = len(tests)
    
    for test_name, test_func in tests:
        print(f"\\n🧪 Running {test_name} Test...")
        try:
            if test_func():
                passed += 1
                print(f"✅ {test_name} test PASSED")
            else:
                print(f"❌ {test_name} test FAILED")
        except Exception as e:
            print(f"❌ {test_name} test ERROR: {e}")
    
    print(f"\\n📋 Test Summary")
    print("=" * 30)
    print(f"Passed: {passed}/{total}")
    print(f"Success Rate: {passed/total*100:.1f}%")
    
    if passed == total:
        print("\\n🎉 All tests passed! The repository is ready for reproducible benchmarks.")
        return 0
    else:
        print(f"\\n⚠️  {total - passed} tests failed. Please check the issues above.")
        return 1

if __name__ == "__main__":
    sys.exit(main())