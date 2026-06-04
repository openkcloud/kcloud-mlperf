/**
 * Pure deterministic MMLU answer scoring (US-004).
 *
 * Prior platform code wrote `accuracy: 0` unconditionally for every NPU MMLU
 * sample (npu-eval.service.ts), so the result_accuracy column was empty and
 * the comparison page's MMLU rows showed no accuracy. This module fills that
 * gap with a deterministic letter-extraction scorer that any caller can use:
 *
 *   - scoreMmluAnswer(completion, expected) → 0 | 1
 *   - scoreMmluRun(completions[], expected[]) → { correct, total, accuracy_pct }
 *
 * The extraction rule: pick the FIRST standalone A/B/C/D letter (case
 * insensitive, surrounded by non-letter or string boundary) in the
 * completion text. Refusals or completions with no letter score 0.
 *
 * Why a standalone-letter regex (not full text match): MMLU evaluation is
 * traditionally letter-classification. Models often pad with prose
 * ("The answer is A.", "Let me think... A"); the first standalone letter
 * is a robust deterministic proxy that aligns with widely-used eval harnesses
 * (e.g., lm-evaluation-harness uses similar logic).
 */

// MMLU-Pro is a TEN-option benchmark (A–J), unlike classic MMLU (A–D). The
// option letter can be anywhere in A..J; scoring against only A–D silently
// marked every E–J answer wrong and produced non-comparable accuracy.
export type MmluLetter =
  | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J';

const VALID_LETTERS = new Set<string>([
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J',
]);

/** True iff `s` (already uppercased) is a valid MMLU-Pro option letter A–J. */
export function isMmluLetter(s: string): s is MmluLetter {
  return VALID_LETTERS.has(s);
}

// Extraction is staged most-reliable first. Empirically (furiosa-llm
// Llama-3.1-8B, temp 0, prompt primed with "Answer:") the completion LEADS
// with the chosen letter then explains, e.g. " D\nExplanation: ...".
//
// The hard part of 10-option MMLU-Pro is that two option letters — "A" and
// "I" — are also common English words. A naive "first standalone uppercase"
// scan mis-reads "I think the answer is C" as I. So:
//   - the global prose scan is restricted to [B-HJ] (letters that are never
//     English words);
//   - a LEADING "A"/"I" only counts as the answer when followed by punctuation
//     / newline / end ("A.", "I)"), not by a space ("A common", "I think").

// Leading option letter immediately followed by an answer boundary.
const LEAD_LETTER_RE = /^([A-J])([\s).:,;\]\-]|$)/;
// Explicit declaration: "answer is X", "option (X)", "correct choice: X".
const ANSWER_DECL_RE =
  /\b(?:answer|option|choice|correct)\b[^A-Za-z0-9]{0,8}(?:is\b[^A-Za-z0-9]{0,3})?([A-J])(?![A-Za-z])/i;
// Completion is just one or more A–J characters ("C", "BBBBB", "  c  ").
const PURE_LETTER_RE = /^\s*([A-Ja-j])[A-Ja-j]*\s*$/;
// A standalone lowercase a–j (e.g. "answer: a").
const STANDALONE_LOWER_RE = /(?:^|[^A-Za-z])([a-j])(?:$|[^A-Za-z])/;
// Last resort: a standalone uppercase B–H or J anywhere. A/I deliberately
// excluded so stray English-word "A"/"I" never false-match.
const STANDALONE_UPPER_BHJ_RE = /(?:^|[^A-Za-z])([B-HJ])(?:$|[^A-Za-z])/;

export function extractMmluLetter(
  completion: string | null | undefined,
): MmluLetter | null {
  if (typeof completion !== 'string' || completion.length === 0) return null;
  // Strip leading decoration ("(", quotes, markdown, whitespace).
  const t = completion.replace(/^[\s>*_'"`(\[]+/, '');

  const lead = t.match(LEAD_LETTER_RE);
  if (lead) {
    const L = lead[1];
    const spaceLike = lead[2] === ' ' || lead[2] === '\t';
    // Accept unless it is an ambiguous "A"/"I" followed by a space (prose).
    if (!((L === 'A' || L === 'I') && spaceLike) && isMmluLetter(L)) return L;
  }
  for (const re of [
    ANSWER_DECL_RE,
    PURE_LETTER_RE,
    STANDALONE_LOWER_RE,
    STANDALONE_UPPER_BHJ_RE,
  ]) {
    const m = t.match(re);
    if (m) {
      const letter = m[1].toUpperCase();
      if (isMmluLetter(letter)) return letter;
    }
  }
  return null;
}

export function scoreMmluAnswer(
  completion: string | null | undefined,
  expected: MmluLetter,
): 0 | 1 {
  const letter = extractMmluLetter(completion);
  if (letter === null) return 0;
  return letter === expected ? 1 : 0;
}

export interface MmluRunScore {
  correct: number;
  total: number;
  accuracy_pct: number;
}

export function scoreMmluRun(
  completions: ReadonlyArray<string | null | undefined>,
  expected: ReadonlyArray<MmluLetter>,
): MmluRunScore {
  if (completions.length !== expected.length) {
    throw new Error(
      `scoreMmluRun: length mismatch — completions=${completions.length} expected=${expected.length}`,
    );
  }
  if (completions.length === 0) {
    return { correct: 0, total: 0, accuracy_pct: 0 };
  }
  let correct = 0;
  for (let i = 0; i < completions.length; i++) {
    correct += scoreMmluAnswer(completions[i], expected[i]);
  }
  const accuracy_pct = (100 * correct) / completions.length;
  return {
    correct,
    total: completions.length,
    accuracy_pct: Math.round(accuracy_pct * 100) / 100,
  };
}
