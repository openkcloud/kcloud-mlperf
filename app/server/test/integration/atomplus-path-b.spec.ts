/**
 * Lane A integration smoke for the Atom+ in-cluster path.
 *
 * These tests assume the pod is running INSIDE the cluster and can resolve
 * `vllm-atomplus.npu.svc.cluster.local`.  When run outside the cluster they
 * are skipped with `it.skip` (jest's `xit` equivalent) so CI on a developer
 * laptop or the host node1 stays green.
 *
 * Trigger flag: set ATOMPLUS_INTEGRATION=1 in the env to opt in.  This
 * intentionally requires an explicit signal so noisy networks/test runners
 * don't pummel the live NPU during normal `npx jest` runs.
 *
 * Verification matches the assertions in
 *   /home/kcloud/etri-llm-exam-solution/.omc/state/lane-a-atomplus-report.md
 */

import * as http from 'http';

const ATOM_BASE_URL =
  process.env.ATOM_INFERENCE_URL ??
  'http://vllm-atomplus.npu.svc.cluster.local:8000';

const SHOULD_RUN = process.env.ATOMPLUS_INTEGRATION === '1';
const maybeIt = SHOULD_RUN ? it : it.skip;

interface ModelsResponse {
  object: string;
  data: Array<{ id: string; object: string; root?: string }>;
}

interface CompletionsResponse {
  id: string;
  object: string;
  choices: Array<{ text: string; finish_reason?: string }>;
  usage?: { completion_tokens?: number; prompt_tokens?: number };
}

function httpRequest(
  method: 'GET' | 'POST',
  url: string,
  body?: object,
  timeoutMs = 30000,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        method,
        host: u.hostname,
        port: u.port || 80,
        path: u.pathname + u.search,
        headers: {
          'content-type': 'application/json',
          ...(payload ? { 'content-length': Buffer.byteLength(payload) } : {}),
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error(`request to ${url} timed out after ${timeoutMs}ms`));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

describe('Atom+ in-cluster vllm-rbln service (Lane A)', () => {
  // Lane A acceptance criteria #A: Service DNS resolves and /v1/models returns
  // the Llama compiled model.
  maybeIt(
    'serves the Llama-3.1-8B model at /v1/models via Service DNS',
    async () => {
      const res = await httpRequest('GET', `${ATOM_BASE_URL}/v1/models`);
      expect(res.status).toBe(200);
      const json = JSON.parse(res.body) as ModelsResponse;
      expect(json.object).toBe('list');
      expect(json.data.length).toBeGreaterThan(0);
      const ids = json.data.map((m) => m.id);
      expect(ids).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/Llama-3\.1-8B-Instruct/i),
        ]),
      );
    },
    60_000,
  );

  // Lane A acceptance criteria #B: Real generation returns >0 tokens.
  // 5 tokens is plenty to confirm the engine actually decoded; we don't
  // assert content because Atom+ generation is non-deterministic at temp>0
  // and asserting on text would make the test flaky.
  maybeIt(
    'POST /v1/completions yields a non-zero-token completion',
    async () => {
      const res = await httpRequest(
        'POST',
        `${ATOM_BASE_URL}/v1/completions`,
        {
          model: 'rebellions/Llama-3.1-8B-Instruct',
          prompt: 'Hello',
          max_tokens: 5,
          temperature: 0,
        },
        90_000,
      );
      expect(res.status).toBe(200);
      const json = JSON.parse(res.body) as CompletionsResponse;
      expect(json.choices.length).toBeGreaterThan(0);
      const text = json.choices[0]?.text ?? '';
      const completionTokens = json.usage?.completion_tokens ?? 0;
      // Either the usage block reports tokens, or the text is non-empty —
      // both signal a real decode.  Some vllm-rbln versions omit usage.
      expect(completionTokens > 0 || text.length > 0).toBe(true);
    },
    120_000,
  );
});
