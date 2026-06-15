import { Logger } from '@nestjs/common';

/**
 * Per-exam reproducibility metadata captured at create-time. Every field is
 * nullable because production deployments may not yet have all env vars wired
 * (e.g., a dev pod may have POD_NAME but not IMAGE_DIGEST). The capture
 * function logs a single warn the first time any field is missing so the
 * operator notices, but never throws — partial metadata is better than none.
 *
 * Wire-up (Helm values pass these via downward API + image pull metadata):
 *   POD_NAME              → spec.template.spec.containers[].env (downward API)
 *   NODE_NAME             → spec.template.spec.containers[].env (downward API)
 *   IMAGE_DIGEST          → injected by CI/CD when pushing the image (sha256:...)
 *   GIT_COMMIT_SHA        → injected by CI/CD at build time
 *   RUNTIME_VERSIONS_JSON → JSON string with node/cuda/vllm/furiosa/rbln versions
 *   RESULT_SCHEMA_VERSION → semver-ish string for the on-disk result.json shape
 */
export interface ReproducibilityMetadata {
  platform_commit_sha: string | null;
  image_digest: string | null;
  k8s_pod_name: string | null;
  k8s_node_name: string | null;
  runtime_versions: string | null;
  result_schema_version: string | null;
}

const logger = new Logger('ReproducibilityMetadata');
let warned = false;

// Test-only seam to reset the once-flag between tests.
export function __resetCaptureWarnedForTests(): void {
  warned = false;
}

const SHA_RE = /^[0-9a-fA-F]{7,40}$/;

function readEnv(name: string): string | null {
  const v = process.env[name];
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function readShaEnv(name: string): string | null {
  const raw = readEnv(name);
  if (raw === null) return null;
  return SHA_RE.test(raw) ? raw : null;
}

export function captureReproducibilityMetadata(): ReproducibilityMetadata {
  const meta: ReproducibilityMetadata = {
    platform_commit_sha: readShaEnv('GIT_COMMIT_SHA'),
    image_digest: readEnv('IMAGE_DIGEST'),
    k8s_pod_name: readEnv('POD_NAME'),
    k8s_node_name: readEnv('NODE_NAME'),
    runtime_versions: readEnv('RUNTIME_VERSIONS_JSON'),
    result_schema_version: readEnv('RESULT_SCHEMA_VERSION'),
  };

  const missing = (
    Object.keys(meta) as Array<keyof ReproducibilityMetadata>
  ).filter((k) => meta[k] === null);

  if (missing.length > 0 && !warned) {
    warned = true;
    logger.warn(
      `Reproducibility metadata partial; missing env: ${missing.join(', ')}. ` +
        `Wire these via downward API + CI/CD to fully reproduce future benchmark runs.`,
    );
  }

  return meta;
}
