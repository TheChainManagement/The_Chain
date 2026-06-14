# Evidence — In-app alerts engine

**Date:** 2026-06-13
**Phase:** 6 (Features)
**Feature:** In-app alerts (FEATURES.md §"In-app alerts")

## What was built

The operator's triage surface. `alertGenerationWorkflow` walks the risk surfaces
and writes deduped alerts — each one an actionable one-sentence memo with a
single cobalt CTA to the fix (the memorable element), not a vague flag.

### Data layer
- `supabase/migrations/20260613140000_alerts_engine.sql`
  - `alert_severity_rank()` helper (info<warn<critical).
  - `upsert_alert(...)` — the dedupe/severity contract, atomic per alert under a row lock.
  - `close_stale_alerts(...)` — auto-closes open alerts of the evaluated kinds whose condition no longer fires.
  - New `superseded` value on `alert_status` (see spec reconciliation below).

### Logic
- `src/lib/alerts/conditions.ts` — pure. `buildFireableAlerts(inputs)` → fireable alerts + operator memos. Conditions: `reorder_due`, `stockout_risk`, `overstock`, `po_late`, `sync_failure`, `sync_conflict`. A SKU with an open recommendation fires `reorder_due` and is suppressed from stockout/overstock (one alert per SKU).
- `src/lib/alerts/generate.ts` — server-only. Reads the surfaces (policies aggregated worst-case per product, open recs, late POs, sync failures, conflict count), upserts each fireable, then auto-closes cleared conditions. Idempotent.
- `src/lib/alerts/queue.ts` — RLS-scoped read model (worst-first).

### Durability + wiring
- `src/workflows/alerts.ts` — `alertGenerationWorkflow(tenantId, nowMs)` (`"use workflow"` → step).
- Wired into the forecast-batch tail (`generateAlertsForBatch` step after `finalizeBatch`) — the "runs after the forecast batch" hook. Plus on-demand `recomputeAlerts`.

### UI
- `/flow/alerts` queue: worst-first rows, severity rail (stop/amber/hairline), operator memo, cobalt CTA, ack/dismiss, recompute. Escalation count surfaced (`escalated ×N`).
- `/flow` upgraded from a BenchStub to a live hub (Alerts + Sync conflicts cards with counts).
- Actions: `acknowledgeAlert`, `dismissAlert` (RLS-fenced, audit-logged via the alerts trigger), `recomputeAlerts`.

## Spec reconciliation (documented deviation)
SYSTEM_DESIGN §Alert generation contract step 4 says, on a severity rise, "insert
a new row with reopen_count+1 **and leave the prior row open**." That is
impossible under the Foundation's unique partial index `(tenant_id, dedupe_key)
WHERE status='open'`. Resolved to satisfy BOTH the "new row on re-alert"
checklist and the index: the prior open row is moved to a new terminal status
`superseded`, and a fresh `open` row is inserted with reopen_count+1.
`auto_closed` stays reserved for a genuinely-cleared condition.

## Verification
- **Tests:** full suite **543 passed** (was 524; +19) + 2 workflow integration. Typecheck + biome clean.
  - Acceptance criteria (DB-real, `tests/alerts/generate.test.ts`): same condition 3× → exactly 1 open row; severity rise → new open row with reopen_count+1 + prior superseded (unique index holds); hold/drop → no new row; condition clears → auto_closed.
  - Pure conditions (`tests/alerts/conditions.test.ts`): fire rules, severity thresholds, one-SKU-one-alert suppression, memos.
  - Actions (`tests/alerts/actions.test.ts`): session gate, RLS-fenced status transition, recompute starts the workflow.
  - Memorable artifact: `_reviews/2026-06-13_feature_alerts_memorable.test.tsx`.
- **Migration:** full chain re-applied clean via `supabase db reset` (incl. `ALTER TYPE ADD VALUE` in-transaction — deploy-safe).
- **Live browser:** seeded representative alerts, signed in, viewed `/flow/alerts` — worst-first triage with severity rails, operator memos carrying real numbers, cobalt CTAs, `escalated ×1` treatment. Acknowledged an alert → it dropped from 5 → 4 open. `/flow` hub shows live counts. No console errors.

## Deferred (ticketed in `_reviews/_tickets.md`)
- `forecast_low_confidence` + `forecast_baseline_fail` conditions (need forecast-confidence read plumbing).
- Alert tray (slide-in right rail) — FEATURES step 4; the queue page is the memorable surface for Wave 1.
- Email channel (`notification_preferences.channel='email'`, Resend) — FEATURES step 6, fast-follow.
- "After each sync" generation hook (currently fires after the forecast batch + on demand).
