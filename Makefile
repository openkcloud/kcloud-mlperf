.PHONY: help build run-offline run-all performance accuracy reports test ci clean run-mlperf run-mmlu report-run clean-results

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
	@echo "  run-mlperf    - Wrapper: scripts/run_mlperf.sh (requires RUN_ID, HF_TOKEN)"
	@echo "  run-mmlu      - Wrapper: scripts/run_mmlu.sh (requires RUN_ID)"
	@echo "  report-run    - Wrapper: scripts/make_report.py for a given RUN_ID"
	@echo "  clean-results - Print which old results would be deleted (dry-run)"
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

run-mlperf:
	@echo "RUN_ID required" && test -n "$(RUN_ID)"
	@echo "HF_TOKEN required" && test -n "$$HF_TOKEN"
	bash scripts/run_mlperf.sh --run-id $(RUN_ID) $(if $(MODEL),--model $(MODEL)) $(if $(DEVICE),--device $(DEVICE))

run-mmlu:
	@echo "RUN_ID required" && test -n "$(RUN_ID)"
	bash scripts/run_mmlu.sh --run-id $(RUN_ID) $(if $(MODEL),--model $(MODEL)) $(if $(DEVICE),--device $(DEVICE))

report-run:
	@echo "RUN_ID required" && test -n "$(RUN_ID)"
	python3 scripts/make_report.py --run-id $(RUN_ID)

clean-results:
	bash scripts/clean_results.sh --keep 1

test:
	bash test_pipeline.sh

ci: build run-all reports test

clean:
	rm -rf reports_* || true

all-in-one:
	bash scripts/run_all_in_one.sh

