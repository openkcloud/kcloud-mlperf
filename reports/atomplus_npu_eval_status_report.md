# Rebellions Atom+ NPU Eval Status — Lane B Report

**RUN_ID**: 20260429-060404-82c193e
**Live URL**: http://10.254.177.41:30001/npu-eval/atomplus

## What the live page shows (Playwright captured)

DOM assertions on `/npu-eval/atomplus`:

| Probe | Result |
|---|---|
| `hasAwaitingPlugin` (text "Awaiting upstream Rebellions … device plugin") | ✅ True |
| `hasRunButton` | ✅ False (no fake Run/Start button) |
| `mentionsAtomplus` (Atom+, Rebellions, Atom Plus) | ✅ True |
| `mentionsRngd` (cross-link to RNGD page) | ✅ True |
| Console errors | 0 |
| Network failures | 0 |
| MUI Paper card count matching RNGD/Atom+ pattern | 3 |

Screenshot: `.omc/qa-live-ui/screenshots-final-rev14/atomplus.png`

## Hardware/runtime status (verified via cluster)

| Layer | Status | Evidence |
|---|---|---|
| node5 joined | ✅ Ready | `kubectl get node node5` → `Ready, SchedulingDisabled` (cordoned by design) |
| node5 vendor label | ✅ Rebellions | `kubectl get node node5 -o yaml` |
| `rbln-smi` / `rbln-stat` | ✅ Present on host | Detected in node5 host scan (prior session) |
| `/dev/rsd0` device file | ✅ Present | Host scan |
| Kubernetes device plugin | ❌ MISSING upstream | `kubectl describe node node5` shows **no `rebellions/atomplus` allocatable resource** |
| Inference framework / runtime image | ❌ MISSING | No vLLM/runtime container shipped by Rebellions |
| Benchmark profiles | ❌ MISSING | `config/benchmark_profiles.yaml` has no atomplus entries |
| Safe benchmarking | 🚫 BLOCKED | All three above must exist |

## Honest UX

The page renders a `BlockerDiagnostic` Alert with **three numbered blockers** matching the table above plus a runbook link. There is **no** Run/Launch button, **no** fake "ready to benchmark" claim. Disabled state is communicated via the Alert, not via greyed-out buttons that could mislead.

The diagnostic-only `/dev/rsd0` privileged hostPath fallback is **not exposed** in this build — it would require explicit admin opt-in and is documented as non-production-grade in the runbook.

## Acceptance

- ✅ Page is reachable from menu (G4)
- ✅ Page clearly states BLOCKED for safe benchmarking (G5)
- ✅ Page does not pretend safe benchmarking is available (G6)

## Open external blocker

This is a **vendor-side dependency**, not a project code defect. The path forward is upstream: Rebellions ships an official Kubernetes device plugin that advertises `rebellions/atomplus` as a schedulable resource and a containerized inference runtime. Until then, `/npu-eval/atomplus` is correct as-is — informative, honest, blocked.
