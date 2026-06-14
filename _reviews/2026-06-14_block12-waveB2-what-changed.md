# Block 12 Wave B2 — "What changed this week" — evidence

**Date:** 2026-06-14
**Scope:** Tenant-level weekly digest insight on the Flow hub (`/flow`), reusing
the Wave A engine. Second of three Wave B slices (B1 "why this forecast" done; B3
what-if interpretation next).

## What shipped
- **`weekly_change` insight kind** — `WeeklyChangeFacts` (4 typed counts: alerts
  raised, reorder flags, PO receipts logged, sync conflicts pending) + `buildWeeklyChangePrompt`.
  Every fact is a count, so there's **no injection surface at all** — the model
  only orders and narrates numbers it was handed. The prompt asks it to lead with
  what needs attention and state a quiet week plainly.
- **`getWeeklyChangeInsight(admin, tenantId, entityId, since)`** — assembles the
  facts via four exact-count head queries over the trailing window
  (`alerts.created_at`, `reorder_recommendations.created_at`,
  `po_receipt_events.applied_at`, plus pending `sync_conflicts`). A failed count
  degrades to 0 so the digest never throws.
- **`weeklyPeriodId(periodKey)`** — `insights.entity_id` is a **uuid** column and
  the digest has no natural entity, so the period stamp (`YYYY-MM-DD`) is mapped to
  a deterministic v5-shaped UUID. One cache row per day; the note regenerates as
  the trailing window rolls forward. **No schema change.** (Caught during testing:
  passing the raw date string silently failed the insert — uuid column.)
- **`loadWeeklyChangeInsight()`** action — tenant claim IS the scope (no entity to
  existence-check); window = trailing 7 days, cache key = today.
- **`WeeklyChangeInsightPanel`** on `/flow`, above the surfaces cards.

## Tests
- `prompts.test.ts`: count interpolation, quiet-week (all-zero, no markup) framing,
  `weeklyPeriodId` deterministic + distinct-per-period + valid v5 uuid shape.
- `cache.test.ts`: `getWeeklyChangeInsight` serves the pre-cached digest (keyed on
  the period uuid) with **no model call**.
- **Suite 566/566**, `tsc` clean, biome clean.

## Live verification (local, real AI Gateway key)
Seeded a loginable tenant with 3 in-window alerts (1 critical stockout_risk, 2 warn
reorder_due), signed in, loaded `/flow`:
- **First view (live model):** *"Three new alerts were raised this week and should
  be your first stop, as nothing else moved — no reorders triggered, no PO receipts
  landed, and no sync conflicts are sitting in the queue. Outside those alerts, the
  week was quiet across the board."* — exactly matches the seeded 3/0/0/0 counts,
  leads with the alerts, calls the rest quiet, invents nothing. 90% confidence,
  caption `anthropic/claude-sonnet-4.6 · prompt v1`.
- The digest's "3 alerts" matches the SURFACES `ALERTS 3` card directly below it —
  trust hierarchy holds (never narrates a number not on a surface below).
- **Reload (cache hit):** caption `· cached`, no second model call.
- **0 console errors.** Throwaway seed + user deleted; seed script removed.

## Deferred to Wave B3
- **What-if slider interpretation** on `/inventory/policy` — Claude reads the
  scrubbed service-level / lead-time trade-off alongside the recomputed
  `<StatNumber>`s.

## Gate remaining before push
`moretech-codex-review`, batched across B1+B2+B3 (MG chose to build the full wave
before the gate).
