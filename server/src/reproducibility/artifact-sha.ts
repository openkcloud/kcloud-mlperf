import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

/**
 * WS-D02-helper — pure SHA-256 capture helpers used to populate the
 * `model_sha`, `dataset_sha`, and `tokenizer_sha` columns added by the
 * canonical-N=11 migration (US-0.5). All helpers return `null` when the
 * referenced files do not exist or cannot be read; they MUST NOT throw,
 * because callers populate these columns opportunistically at result-write
 * time and a missing artifact must not break the benchmark pipeline.
 */

const HEX_RE = /^[0-9a-f]{64}$/;

function sha256OfBuffer(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function sha256OfFile(absPath: string): string | null {
  try {
    const buf = fs.readFileSync(absPath);
    return sha256OfBuffer(buf);
  } catch {
    return null;
  }
}

function isExistingFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function isExistingDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Hash of `<modelDir>/config.json`. `config.json` is present in every HF
 * model directory we ship (vLLM, FuriosaAI, Rebellions all rely on it) and
 * is the most stable model-identity artifact — quantization changes show up
 * in the file as `torch_dtype` / `quantization_config`. Returns null when
 * the directory or `config.json` is missing.
 */
export function computeModelSha(modelDirAbsolutePath: string): string | null {
  if (!modelDirAbsolutePath) return null;
  if (!isExistingDir(modelDirAbsolutePath)) return null;
  const cfgPath = path.join(modelDirAbsolutePath, 'config.json');
  if (!isExistingFile(cfgPath)) return null;
  const sha = sha256OfFile(cfgPath);
  return sha && HEX_RE.test(sha) ? sha : null;
}

/**
 * Hash of a dataset file or — when given a directory — a deterministic
 * concat-sha of the per-file SHA-256s of every regular file inside, sorted
 * by path. The sorted-path concat ensures the result is stable across
 * filesystem orderings.
 */
export function computeDatasetSha(datasetPathOrDir: string): string | null {
  if (!datasetPathOrDir) return null;
  if (isExistingFile(datasetPathOrDir)) {
    return sha256OfFile(datasetPathOrDir);
  }
  if (!isExistingDir(datasetPathOrDir)) return null;

  const files: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isFile()) files.push(full);
      else if (ent.isDirectory()) walk(full);
    }
  };
  walk(datasetPathOrDir);
  if (files.length === 0) return null;
  files.sort();

  const concat = createHash('sha256');
  for (const f of files) {
    const fileSha = sha256OfFile(f);
    if (fileSha === null) return null;
    // Include the relative path so two structurally-different trees don't
    // collide (e.g., `train.json` vs `eval.json` with same bytes).
    const rel = path.relative(datasetPathOrDir, f);
    concat.update(rel);
    concat.update('\0');
    concat.update(fileSha);
    concat.update('\n');
  }
  return concat.digest('hex');
}

/**
 * Per AG-4 default: sha256 of the byte-concatenation of `tokenizer.json`
 * followed by `tokenizer_config.json`. This catches both vocabulary drift
 * (tokenizer.json) and special-token / chat-template drift
 * (tokenizer_config.json), which is exactly the pair the platform needs to
 * compare across vendors. Returns null when either file is missing.
 */
export function computeTokenizerSha(
  modelDirAbsolutePath: string,
): string | null {
  if (!modelDirAbsolutePath) return null;
  if (!isExistingDir(modelDirAbsolutePath)) return null;
  const tokPath = path.join(modelDirAbsolutePath, 'tokenizer.json');
  const tokCfgPath = path.join(modelDirAbsolutePath, 'tokenizer_config.json');
  if (!isExistingFile(tokPath) || !isExistingFile(tokCfgPath)) return null;

  let tokBuf: Buffer;
  let cfgBuf: Buffer;
  try {
    tokBuf = fs.readFileSync(tokPath);
    cfgBuf = fs.readFileSync(tokCfgPath);
  } catch {
    return null;
  }
  return sha256OfBuffer(Buffer.concat([tokBuf, cfgBuf]));
}
