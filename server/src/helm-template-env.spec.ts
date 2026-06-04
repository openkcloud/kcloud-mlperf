/**
 * Snapshot test: verifies the vendored sister-app-chart Helm template
 * renders all 6 reproducibility env-var names in the etri-llm-backend Deployment.
 *
 * Skips gracefully if `helm` binary is not in PATH.
 */

import { execSync } from 'child_process';
import * as path from 'path';

// Jest rootDir is "src"; process.cwd() is the "server" directory at test runtime.
const CHART_PATH = path.resolve(process.cwd(), 'vendored/sister-app-chart');

const REQUIRED_ENV_VARS = [
  'POD_NAME',
  'NODE_NAME',
  'IMAGE_DIGEST',
  'GIT_COMMIT_SHA',
  'RUNTIME_VERSIONS_JSON',
  'RESULT_SCHEMA_VERSION',
];

function helmInPath(): boolean {
  try {
    execSync('helm version --short', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('helm template — etri-llm-backend reproducibility env vars (WS-D01b)', () => {
  let rendered: string;

  beforeAll(() => {
    if (!helmInPath()) {
      console.warn(
        '[helm-template-env.spec] helm binary not found in PATH — skipping',
      );
      return;
    }
    rendered = execSync(`helm template ${CHART_PATH}`, {
      encoding: 'utf-8',
    });
  });

  test.each(REQUIRED_ENV_VARS)(
    'etri-llm-backend Deployment contains env var %s',
    (envVar) => {
      if (!helmInPath()) {
        console.warn(
          `[helm-template-env.spec] skipping check for ${envVar} — helm not in PATH`,
        );
        return;
      }
      expect(rendered).toContain(envVar);
    },
  );
});
