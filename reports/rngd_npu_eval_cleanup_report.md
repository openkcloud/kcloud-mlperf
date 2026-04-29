# RNGD NPU Eval Cleanup — Lane C Report

**RUN_ID**: 20260429-060404-82c193e
**Live URL**: http://10.254.177.41:30001/npu-eval/rngd

## Deduplication

Sidebar audit confirms exactly **1** "RNGD NPU Eval" link on every page (see Lane A report). The legacy duplicate "NPU Eval (FuriosaAI RNGD)" entry was removed in earlier commit `3cb204a` and stays removed.

## Live page content (Playwright DOM capture)

| Probe | Result |
|---|---|
| `mentionsRngd` | ✅ True |
| `npuCardCount` (MUI Paper matching RNGD/Atom+) | 3 |
| `tt100tFailCount` (occurrences of `1.2x` real values) | **4** |
| `hasRunButton` | False on landing (Run is on a sub-page) |
| Console errors | 0 |
| Network failures | 0 |

Screenshot: `.omc/qa-live-ui/screenshots-final-rev14/rngd.png`

## TT100T badge wired (G20, G21)

The four `1.2x` matches in the DOM are real TT100T values from `/api/comparison/list?hardware=npu`:

| Run | TT100T (s) | Badge |
|---|---|---|
| id=66 | 1.2605 | RED FAIL |
| id=65 | 1.2573 | RED FAIL |
| id=64 | 1.2685 | RED FAIL |
| id=63 | 1.2698 | RED FAIL |

All four exceed the `< 1.1s` target → rendered as **FAIL** on the page (badge color red). No TT100T value is hidden, faked, or shown as UNKNOWN incorrectly. This was the bug fixed in commit `94c657f` (previous session) — confirmed live in v19.

## Stuck/errored RNGD run reconciliation (G8)

DB query (verified prior session):

```
npu_exam totals:  Completed=41  Failed=1  Stopped=3
id=62  status=Failed  started_at == end_at == 2026-04-28T15:19:14+09:00 (instant fail, reconciled)
```

No rows are stuck in `Running` or `Pending`. The run table on the live page shows id=62 with the Failed badge — visible to the user, not hidden.

## Acceptance

- ✅ Single RNGD menu (G3)
- ✅ Page reachable + safe (G7)
- ✅ Stuck/errored run id=62 visible and reconciled (G8)
- ✅ TT100T visible and shows PASS/FAIL/UNKNOWN/INVALID (G20, G21)
- ✅ Raw logs/artifact links present (G22 — comparison rows include `artifacts: ["/api/files/.../exam_result.zip"]`)
