# MLPerf Hardware Adapters
# Universal adapters for different accelerator types

from .furiosa_adapter import (
    FuriosaMLPerfAdapter,
    FuriosaMLPerfBenchmark,
    check_furiosa_availability,
    list_furiosa_devices,
    create_furiosa_benchmark
)

__all__ = [
    'FuriosaMLPerfAdapter',
    'FuriosaMLPerfBenchmark', 
    'check_furiosa_availability',
    'list_furiosa_devices',
    'create_furiosa_benchmark'
]