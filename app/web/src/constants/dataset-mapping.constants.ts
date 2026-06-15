/**
 * Model-to-dataset mapping for each benchmark type.
 * These datasets are stored on the NFS server at /mnt/datasets/.
 *
 * MLPerf: Uses CNN evaluation dataset for accuracy/performance benchmarks.
 * MMLU-Pro: Uses MMLU-Pro evaluation dataset for multi-subject accuracy.
 *
 * When adding new models, add their dataset mapping here.
 */

export const MLPERF_DATASET_MAP: Record<string, string[]> = {
  'Llama-3.1-8B-Instruct': ['cnn_eval.json'],
  'Llama-3.1-8B-Instruct-FP8': ['cnn_eval.json']
};

export const MMLU_DATASET_MAP: Record<string, string[]> = {
  'Llama-3.1-8B-Instruct': ['mmlu-pro'],
  'Llama-3.1-8B-Instruct-FP8': ['mmlu-pro']
};
