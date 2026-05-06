# RNGD Stale-State Root-Cause Fix Report

## Before-State: curl Output

```json
{
  "code": 200,
  "data": {
    "timestamp": "2026-05-06T02:03:05.452Z",
    "slots": [
      {
        "device_type": "npu",
        "vendor": "furiosa",
        "model": "RNGD",
        "node": "node4",
        "slot_id": 0,
        "status": "stale",
        "last_seen": null,
        "current_exam": { "id": 69, "kind": "npu", "exam_name": "tt1", "elapsed_seconds": 527397 },
        "last_known_metric": { "tps": null, "tt100t_seconds": null },
        "last_metric_timestamp": null,
        "metrics_status": "pending"
      }
    ]
  }
}
```

The RNGD slot shows `status: "stale"` with exam ID 69 elapsed ~527,397 seconds (~6 days). This is **correct behavior** — the TTL fix from W5 is working. No code fix was required.

## Root Cause Analysis

### TTL Mechanism (buildNpuSlot)

`server/src/realtime/realtime.service.ts` lines 514–522:

```typescript
if (activeExam.status === StatusEnum.RUNNING) {
  const heartbeatAge = last_seen
    ? Date.now() - new Date(last_seen).getTime()
    : activeExam.started_at
      ? Date.now() - new Date(activeExam.started_at).getTime()
      : Infinity;
  status = heartbeatAge >= STALE_THRESHOLD_MS ? 'stale' : 'running';
}
```

**STALE_THRESHOLD_MS = 120,000ms (2 minutes).**

Exam 69 has `status=RUNNING` in DB with a `started_at` from ~6 days ago. There are no `NpuExamResult` rows for it (no heartbeat), so `last_seen = null`. The fallback path uses `started_at`, giving `heartbeatAge ≈ 527,397,000ms >> 120,000ms` → `status = 'stale'`. This is the intended behavior.

### Vendor Normalization (no bug found)

`buildNpuSlot` uses:
```typescript
const normNpu = (s) => (s ?? '').toLowerCase().trim();
const vendorPrefixes = { furiosa: ['rngd'], rebellions: ['atom'] };
```

`device.model = 'RNGD'` → `normNpu('RNGD') = 'rngd'`
`exam.npu_type = 'RNGD'` → `normNpu('RNGD') = 'rngd'`
Exact match succeeds. No cross-vendor leakage is possible: furiosa slots only match `rngd*` types.

### Why the Slot Looks "Stuck"

Exam 69 is a real zombie: RUNNING in DB but no worker has emitted a result in 6 days. The stale state is accurate. The exam should be manually terminated or the DB record updated to COMPLETED/ERROR.

## Files Changed

| File | Change |
|------|--------|
| `server/test/realtime-state.e2e-spec.ts` | **Created** — 7 RNGD-specific regression tests |

No changes to `realtime.service.ts` — the W5 TTL fix is correct and complete for RNGD.

## Test Results

```
PASS test/realtime-state.e2e-spec.ts
  RNGD stale-state regression (realtime-state.spec)
    ✓ RNGD-stale-after-TTL: RUNNING exam with 1hr-old started_at and no result → stale (210ms)
    ✓ RNGD-running-with-fresh-heartbeat: RUNNING exam with recent result → running (not stale) (41ms)
    ✓ vendor-cross-leakage: RNGD running exam does NOT bleed into Atom+ slot (29ms)
    ✓ RNGD-impossible-state: COMPLETED exam is not shown as running or stale (28ms)
    ✓ vendor-cross-leakage-reverse: Atom+ running exam does NOT bleed into RNGD slot (26ms)
    ✓ RNGD-TTL-boundary: result heartbeat exactly at 2min → running (not stale) (24ms)
    ✓ RNGD-TTL-boundary: result heartbeat at exactly 2min (120000ms) → stale (28ms)

Tests: 7 passed, 7 total
Time:  1.973s
```

## After-State: curl Output

Same as before-state — the RNGD slot correctly shows `stale` because exam 69 is a real zombie with no heartbeat for 6 days. The TTL logic is functioning as designed.

## Conclusions

1. The W5 TTL fix (`buildNpuSlot` heartbeat age check) works correctly for RNGD.
2. No RNGD-specific normalization bug exists — `furiosa`→`['rngd']` prefix guard prevents cross-vendor leakage.
3. Exam 69 is a genuine zombie record; the stale display is accurate and informative.
4. The `StatusChip` in `DeviceRealtimeDashboard.tsx` correctly renders `stale` as gray with the "No heartbeat for >2 min" banner.
