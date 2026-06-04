// Maps raw backend/operator error strings into human, actionable guidance.
// Keeps the raw text available (for operators) while leading with what the
// user should DO — closes the audit's HIGH "error-handling" gap.

export type FriendlyError = { title: string; detail: string; action?: string; raw: string };

const RULES: { match: RegExp; title: string; detail: string; action: string }[] = [
  {
    match: /MMLU dataset not loaded|mmlu-pro to be available/i,
    title: 'MMLU-Pro dataset not loaded',
    detail: 'The benchmark could not find the MMLU-Pro dataset on the cluster NFS.',
    action: 'Materialise /mnt/datasets/mmlu-pro/test.jsonl (data restore or app-layer Step 8), then retry.',
  },
  {
    match: /Inference server not available|for npu_type=/i,
    title: 'NPU inference server unavailable',
    detail: 'The benchmark client could not reach the NPU inference server.',
    action: 'RNGD: ensure furiosa-llm is up at node4:8000. Atom+: node5 server (available June 4). Then retry.',
  },
  {
    match: /no nodes have enough resources|Failed to schedule/i,
    title: 'No free accelerator',
    detail: 'All matching devices were busy when the operator tried to schedule this run.',
    action: 'Wait for a current run to finish (max 2 concurrent GPU runs) and retry — the run was not lost.',
  },
  {
    match: /ImagePullBackOff|Back-off pulling image/i,
    title: 'Worker image not cached on the node',
    detail: 'The benchmark worker image was not present on the scheduled node and the pull stalled.',
    action: 'Pre-pull mondrianai/etri-llm-mlperf:v0.2 on the GPU nodes (app-layer Step 3b), then retry.',
  },
  {
    match: /Unknown dtype|bf16/i,
    title: 'Invalid precision value',
    detail: 'The precision string is not a valid runtime dtype.',
    action: 'Use "bfloat16" (not "bf16") for GPU bf16 runs.',
  },
  {
    match: /KV cache|max_position_embeddings|out of memory|CUDA out of memory/i,
    title: 'Out of accelerator memory',
    detail: 'The model context/KV cache did not fit in device memory.',
    action: 'Cap the model max_position_embeddings (e.g. 8192 for A30 24GB) or lower batch size, then retry.',
  },
];

export function friendlyError(raw?: string | null): FriendlyError | null {
  if (!raw || !String(raw).trim()) return null;
  const text = String(raw);
  for (const r of RULES) {
    if (r.match.test(text)) return { title: r.title, detail: r.detail, action: r.action, raw: text };
  }
  return {
    title: 'Run failed',
    detail: text.length > 160 ? `${text.slice(0, 160)}…` : text,
    raw: text,
  };
}
