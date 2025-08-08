## Quickstart

# Build container
make build

# Run full pipeline (requires HF_TOKEN in env)
HF_TOKEN=... make run-all

# Performance-only run
HF_TOKEN=... make performance

# Generate latest report
make reports

### Conventions
- Results: ./results/<YYYYmmdd-HHMMSS>/<task>/{raw,summary}.[json|csv|md]
- Latest: ./results/latest symlink to most recent run
- Cache: ./\.cache mounted to container for speed
- Scripts: ./scripts/*
