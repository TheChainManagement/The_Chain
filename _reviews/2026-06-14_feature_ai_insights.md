# Feature: AI insights layer (Claude) — Block 12 — closed end to end

**Date:** 2026-06-14 (Wave A earlier; Wave B + Codex round this session)
**Status:** Feature-complete. Four insight kinds shipped, all lazy + cached through
the `insights` table, all routed via Vercel AI Gateway with a model-fallback chain,
all data-driven confidence (never model self-report).

## The four surfaces
| Kind | Where | Entity / cache key |
|---|---|---|
| `reorder` — "Why this reorder" | PO detail `/purchase-orders/[poId]` | PO id |
| `forecast` — "Why this forecast" | `/forecasts/[productId]` | latest forecast id (busts on recompute) |
| `weekly_change` — "What changed this week" | Flow hub `/flow` | period→uuid (`weeklyPeriodId`) |
| `policy_whatif` — "If you do this…" | policy bench `/inventory/policy` | scenario hash (`whatIfScenarioId`) |

## Shared design
- `src/lib/insights/generate.ts` — one cached generator core; `callModel` (gateway +
  `[haiku-4.5, gpt-5.4]` fallback, 402/429 → graceful degrade, token-usage log).
- `src/lib/insights/prompts.ts` — versioned templates; every interpolated label
  (`sku`, `supplierName`) passes `safeLabel` (no prompt-injection surface).
- `stableUuid` — deterministic cache identity for kinds with no natural row (weekly
  period, what-if scenario). No schema change (`insights.entity_id` is uuid).
- `<ClaudeInsight>` is the only path to Claude prose; the trust-hierarchy lint
  (`tests/insights/trust-hierarchy.test.ts`) enforces it never wraps a `<StatNumber>`.
- **Trust hierarchy grounded on every surface:** B1 cites chart numbers; B2 has a
  "This week" count strip on Flow; B3 has a "Saved ·" baseline reference. (Reorder
  surface's policy-number grounding is ticketed.)

## Evidence trail
- Wave A: `_reviews/2026-06-14_block12_ai_insights_evidence.md`
- B1: `_reviews/2026-06-14_block12-waveB1-why-this-forecast.md`
- B2: `_reviews/2026-06-14_block12-waveB2-what-changed.md`
- B3: `_reviews/2026-06-14_block12-waveB3-whatif-interpretation.md`
- Memorable artifact: `_reviews/2026-06-14_feature_insights_memorable.test.tsx`
- Codex review + decisions: `_reviews/2026-06-14_block12_waveB.md`

## Tests
Suite green; insight + policy coverage: prompt building + injection-safety + data-driven
confidence + `deriveScenario` parity + `weeklyPeriodId`/`whatIfScenarioId` determinism +
cache-path integration (all four kinds serve cached without a model call). `next build` clean.

## Live verification (real AI Gateway key)
All four kinds generated real, faithful prose from structured facts and served `· cached`
on repeat. Details in the per-wave evidence files above.

## Open follow-ups (ticketed in `_reviews/_tickets.md`)
Right-rail placement, per-tenant cost counter, durable step-wrapping (request-path today),
model-fallback live drill, reorder policy-number surface, multi-line PO narration, weekly
same-day staleness, insight error granularity.
