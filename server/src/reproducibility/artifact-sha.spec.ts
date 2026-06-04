import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import {
  computeDatasetSha,
  computeModelSha,
  computeTokenizerSha,
} from './artifact-sha';

const HEX64 = /^[0-9a-f]{64}$/;
const FIXTURE_DIR = path.resolve(__dirname, '../../test/fixtures/model-shas');

describe('computeModelSha (WS-D02)', () => {
  it('returns a deterministic 64-hex sha for a fixture model dir', () => {
    const sha1 = computeModelSha(FIXTURE_DIR);
    const sha2 = computeModelSha(FIXTURE_DIR);
    expect(sha1).toMatch(HEX64);
    expect(sha1).toBe(sha2);
  });

  it('matches a hand-computed sha256 of <dir>/config.json', () => {
    const expected = createHash('sha256')
      .update(fs.readFileSync(path.join(FIXTURE_DIR, 'config.json')))
      .digest('hex');
    expect(computeModelSha(FIXTURE_DIR)).toBe(expected);
  });

  it('returns null when the model directory does not exist', () => {
    expect(computeModelSha('/no/such/path/abc-xyz-123')).toBeNull();
  });

  it('returns null when config.json is missing from the model dir', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omc-model-sha-'));
    try {
      // No config.json in this temp dir
      expect(computeModelSha(tmp)).toBeNull();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('returns null on empty input', () => {
    expect(computeModelSha('')).toBeNull();
  });
});

describe('computeTokenizerSha (WS-D02)', () => {
  it('returns a deterministic 64-hex sha for a fixture model dir', () => {
    const sha1 = computeTokenizerSha(FIXTURE_DIR);
    const sha2 = computeTokenizerSha(FIXTURE_DIR);
    expect(sha1).toMatch(HEX64);
    expect(sha1).toBe(sha2);
  });

  it('matches sha256(concat(tokenizer.json, tokenizer_config.json)) per AG-4 default', () => {
    const tok = fs.readFileSync(path.join(FIXTURE_DIR, 'tokenizer.json'));
    const cfg = fs.readFileSync(
      path.join(FIXTURE_DIR, 'tokenizer_config.json'),
    );
    const expected = createHash('sha256')
      .update(Buffer.concat([tok, cfg]))
      .digest('hex');
    expect(computeTokenizerSha(FIXTURE_DIR)).toBe(expected);
  });

  it('returns null when tokenizer.json is missing', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omc-tok-sha-'));
    try {
      fs.writeFileSync(path.join(tmp, 'tokenizer_config.json'), '{}');
      expect(computeTokenizerSha(tmp)).toBeNull();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('returns null when the directory does not exist', () => {
    expect(computeTokenizerSha('/no/such/dir/xyz')).toBeNull();
  });
});

describe('computeDatasetSha (WS-D02)', () => {
  it('returns a deterministic 64-hex sha for a single file', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omc-ds-sha-'));
    try {
      const file = path.join(tmp, 'eval.jsonl');
      fs.writeFileSync(file, '{"q":"1+1=?","a":"2"}\n');
      const sha1 = computeDatasetSha(file);
      const sha2 = computeDatasetSha(file);
      expect(sha1).toMatch(HEX64);
      expect(sha1).toBe(sha2);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('returns a deterministic concat-sha across multiple files in a dir', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omc-ds-sha-dir-'));
    try {
      fs.writeFileSync(path.join(tmp, 'a.json'), 'A');
      fs.writeFileSync(path.join(tmp, 'b.json'), 'B');
      const sha1 = computeDatasetSha(tmp);
      const sha2 = computeDatasetSha(tmp);
      expect(sha1).toMatch(HEX64);
      expect(sha1).toBe(sha2);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('returns null for a nonexistent path', () => {
    expect(computeDatasetSha('/no/such/dataset/xyz')).toBeNull();
  });

  it('returns null for an empty input string', () => {
    expect(computeDatasetSha('')).toBeNull();
  });
});
