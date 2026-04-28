# Security Review

**RUN_ID**: 20260428-075351-71c9c77
**Scope**: `etri-llm-exam-solution` + cross-repo `mondrianai-etri-llm-deployments-a9c4c59c4869`
**Verdict**: HIGH — 2 critical leaks, 7 high-severity findings, no auth layer.

## Summary
- Critical: 2 (HF token in `NODE4_HANDOFF.md`, DB password literal in helm secret template)
- High: 7
- Medium: 6
- Low: 3

## 1. Secret leakage

| Severity | File | Line | Issue |
|---|---|---|---|
| **CRITICAL** | `NODE4_HANDOFF.md` | 48 | HuggingFace token `hf_…` committed in plaintext. Anyone with repo read can pull gated models. |
| **CRITICAL** | `mondrianai-…/kubernetes/app-chart/templates/etri-llm-backend/secret.yaml` | 16 | `DATABASE_PASSWORD: <DB_PASSWORD>` literal in `stringData`. Postgres root creds. |
| **HIGH** | `.omc/plans/autopilot-impl.md` | (now redacted) | PAT history reference; rotate cadence verified. |
| **LOW** | `docker-compose.prod.yml` | 33 | `POSTGRES_PASSWORD: password` — local-prod compose; replace with `${DATABASE_PASSWORD}`. |

**Remediation order**:
1. Rotate HF token at https://huggingface.co/settings/tokens **now**.
2. Rotate Postgres password; replace literal with `{{ required ... .Values.secrets.dbPassword }}`.
3. Scrub git history (`git filter-repo --replace-text`); force-push.

## 2. Unsafe shell execution
**No findings.** Backend has zero `child_process|execSync|spawn` calls.

## 3. Path traversal
**MED** — `mp-exam-result.service.ts:290-332` (`getExamResultPath`/`getSubmissionReportPath`). Path is built with `path.join(process.cwd(), 'mnt', 'result', \`mlperf-${examId}\`, ...)`. ParseIntPipe currently prevents `..` injection, but no `path.resolve` containment check; future relaxation would re-enable traversal.
**Fix pattern**:
```ts
const ALLOWED_ROOT = path.resolve(process.cwd(), 'mnt', 'result');
const resolved = path.resolve(ALLOWED_ROOT, ...);
if (!resolved.startsWith(ALLOWED_ROOT + path.sep)) throw new ForbiddenException();
```

## 4. AuthN / AuthZ
**HIGH** — Zero Guards / Strategies / Roles in the backend. Every controller is unauthenticated. Service is `NodePort 30980` (cluster-network reachable). For an internal lab tool this is acceptable IF backed by NetworkPolicy + VPN; if externally reachable, add `@nestjs/passport` JWT guard via `APP_GUARD` plus a `@Public()` decorator on health endpoints.

## 5. Container privilege
- `furiosa-rngd-device-plugin.yaml:56` — `privileged: true` (typical for NPU; flag).
- `furiosaai/k8s-device-plugin:latest` — supply-chain risk. Pin to a digest. **MED**
- App-chart Deployments (backend, frontend, db, api) lack explicit `securityContext`. Add `runAsNonRoot: true`, `readOnlyRootFilesystem: true`, drop ALL caps. **LOW**

## 6. Dependency risks (`npm audit --omit=dev`)
- **server**: 22 vulns (1 critical / 10 high / 10 moderate / 1 low). Highlights: `@nestjs/core` (GHSA-36xv-jgw5-4q75), `validator` (GHSA-vghf-hv5q-vc2g).
- **web**: 6 vulns (4 high / 2 mod). Highlights: `axios` (GHSA-43fc-jf86-j433, GHSA-3p68-rc4w-qgx5), `xlsx` no upstream fix → recommend swap to `exceljs`.
- Run `npm audit fix` before next deploy; review breaking-change fixes in staging.

## 7. LogQL injection
**MED** — `loki.service.ts:25-27` interpolates `benchmark` into the LogQL label selector without escaping. TypeScript types are erased at runtime; the controller `loki.controller.ts:11` does NOT enum-validate. Crafted input can break out of the label selector.
**Fix**: add `new ParseEnumPipe(['mmlu','mlperf'])` to the `:benchmark` param.

## 8. CORS
**HIGH** — `server/src/main.ts:9-15` uses `origin: '*', methods: '*', allowedHeaders: '*'`. Combined with NodePort + no auth, any browser origin can mutate the API.
**Fix**: `origin: process.env.FRONTEND_ORIGIN ?? 'http://10.254.184.195:30001'`.

## 9. K8s manifests (cross-repo)
- Job templates set requests + limits (sensible).
- All Job templates correctly use `imagePullSecrets: image-pull-secret`.
- No `NetworkPolicy` anywhere. **MED** — add default-deny + allowlist (backend↔db, backend↔loki).
- `:latest` device-plugin image (Section 5).

## 10. CI/CD
**HIGH** — No `.github/workflows/` present. The HF-token leak in §1 is the natural consequence — no automated secret scan. Recommend a CI workflow with: `npm ci → build → test → npm audit --audit-level=high`, plus `gitleaks/gitleaks-action@v2` and helm-lint.

## Security Checklist
- [ ] No hardcoded secrets — **FAIL**
- [x] Most inputs validated (DTOs use class-validator) — gap on Loki benchmark param
- [ ] Injection prevention — gap on LogQL string concat
- [ ] AuthN/AuthZ — **FAIL**
- [ ] Dependencies audited & up-to-date — **FAIL**
- [ ] CORS restricted — **FAIL**
- [ ] Container least-privilege — partial (operator only)
- [ ] CI secret-scan gate — **FAIL**

## Remediation timeline
1. **<1h**: rotate HF + DB passwords (this PR redacts the HF leak in NODE4_HANDOFF.md).
2. **<24h**: scrub history, restrict CORS, ParseEnumPipe Loki, switch Service to ClusterIP or add ingress auth.
3. **<1wk**: `npm audit fix` server + web, path-resolve containment on download endpoints, add `.github/workflows/ci.yml`.
4. **<1mo**: JWT guard layer, NetworkPolicies, `runAsNonRoot` + `readOnlyRootFilesystem`, image-digest pinning everywhere.
