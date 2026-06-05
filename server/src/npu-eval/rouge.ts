// ROUGE scoring for MLPerf CNN-DailyMail summarization on the in-process NPU
// path. The GPU MLPerf worker computes ROUGE via the MLPerf accuracy script
// (Python rouge-score); this is an independent TypeScript implementation of the
// standard ROUGE-1/2/L F1 used to score NPU (RNGD / Atom+) summaries against the
// dataset reference (`output`) so Atom+/RNGD get a full-dataset accuracy number
// alongside the GPU pass. Method is documented so the (small) implementation
// differences vs the Python scorer are transparent for the paper.

/** Word tokenizer: lowercase, split on non-alphanumeric, drop empties. */
function tokenize(s: string): string[] {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((t) => t.length > 0);
}

function ngrams(tokens: string[], n: number): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i + n <= tokens.length; i++) {
    const g = tokens.slice(i, i + n).join(' ');
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

function f1(precision: number, recall: number): number {
  return precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
}

/** ROUGE-N F1 from multiset n-gram overlap. */
function rougeN(candTok: string[], refTok: string[], n: number): number {
  const cand = ngrams(candTok, n);
  const ref = ngrams(refTok, n);
  if (cand.size === 0 || ref.size === 0) return 0;
  let overlap = 0;
  for (const [g, c] of cand) {
    const r = ref.get(g);
    if (r) overlap += Math.min(c, r);
  }
  const candTotal = [...cand.values()].reduce((a, b) => a + b, 0);
  const refTotal = [...ref.values()].reduce((a, b) => a + b, 0);
  return f1(overlap / candTotal, overlap / refTotal);
}

/** Longest common subsequence length (token level), O(n*m) space-optimized. */
function lcsLen(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  let prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const curr = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1]);
    }
    prev = curr;
  }
  return prev[b.length];
}

/** ROUGE-L F1 (sentence-level LCS over the full token sequence). */
function rougeL(candTok: string[], refTok: string[]): number {
  if (candTok.length === 0 || refTok.length === 0) return 0;
  const lcs = lcsLen(candTok, refTok);
  return f1(lcs / candTok.length, lcs / refTok.length);
}

export interface RougeScores {
  rouge1_pct: number;
  rouge2_pct: number;
  rougeL_pct: number;
  scored: number;
}

/**
 * Mean ROUGE-1/2/L F1 (as 0–100 percentages) over aligned candidate/reference
 * arrays. Empty candidates (errored samples) score 0 against their reference,
 * so partial/failed generations correctly drag accuracy down rather than being
 * silently skipped. Returns zeros when nothing is scorable.
 */
export function scoreRougeBatch(
  candidates: string[],
  references: string[],
): RougeScores {
  const n = Math.min(candidates.length, references.length);
  if (n === 0) return { rouge1_pct: 0, rouge2_pct: 0, rougeL_pct: 0, scored: 0 };
  let s1 = 0;
  let s2 = 0;
  let sL = 0;
  for (let i = 0; i < n; i++) {
    const c = tokenize(candidates[i]);
    const r = tokenize(references[i]);
    if (r.length === 0) continue;
    s1 += rougeN(c, r, 1);
    s2 += rougeN(c, r, 2);
    sL += rougeL(c, r);
  }
  return {
    rouge1_pct: (s1 / n) * 100,
    rouge2_pct: (s2 / n) * 100,
    rougeL_pct: (sL / n) * 100,
    scored: n,
  };
}
