# SUPERSEDED — older snapshot of vendored sister-app-chart

This directory is an OLDER copy of the canonical vendored chart at:
`/home/kcloud/etri-llm-exam-solution/server/vendored/sister-app-chart/`

## Why it's superseded

- Older mtimes on all 4 differing files
- Missing reproducibility wires (`repro:` config blocks)
- References the obsolete K8s resource name `rebellions.ai/atomplus` (current canonical: `rebellions.ai/ATOM`, advertised by the official `rbln-k8s-device-plugin` DaemonSet)

## Do not use

DO NOT IMPORT, DEPLOY, OR HELM-TEMPLATE ANYTHING FROM THIS TREE.
Use `server/vendored/sister-app-chart/` instead.

Kept for forensic reference only. Safe to delete after 2026-08-01 if no audits cite it.

## Provenance

Created during Lane B of the mondrianai → ETRI migration on 2026-05-12.
Lane B identified this duplicate via `diff -rq` against the canonical vendored chart.
User chose "Keep, but flag in docs" rather than delete.
