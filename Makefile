.PHONY: help build run-offline run-all performance accuracy reports test ci clean all-in-one smoke

SHELL := /bin/bash
RUN_ID ?= $(shell date +%Y%m%d_%H%M%S)
IMAGE?=mlperf-llama3

help:
	@echo "Targets:"
	@echo "  build         - Build Docker image"
	@echo "  run-all       - Full pipeline (requires HF_TOKEN)"
	@echo "  performance   - Performance-only run"
	@echo "  accuracy      - Accuracy-only run"
	@echo "  reports       - Generate reports from latest JSON"
    @echo "  smoke         - Run 10-step smoke (scripts/smoke_all_10.sh)"
	@echo "  test          - Quick local validations"
	@echo "  ci            - Build + run-all + reports + validations"
	@echo "  clean         - Remove reports_* directories"
	@echo "  all-in-one    - Build → MLPerf → MMLU → Report (scripts/run_all_in_one.sh)"

build:
	docker build -t $(IMAGE) .

run-all:
	@echo "HF_TOKEN required" && test -n "$$HF_TOKEN"
	bash run_all.sh

performance:
	@echo "HF_TOKEN required" && test -n "$$HF_TOKEN"
	bash run_all.sh performance

accuracy:
	@echo "HF_TOKEN required" && test -n "$$HF_TOKEN"
	bash run_all.sh accuracy

reports:
	bash generate_report.sh

smoke:
    bash scripts/smoke_all_10.sh

test:
	bash test_pipeline.sh

ci: build run-all reports test

clean:
	rm -rf reports_* || true

all-in-one:
	bash scripts/run_all_in_one.sh

