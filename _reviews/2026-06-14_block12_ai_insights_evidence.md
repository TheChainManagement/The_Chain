# Evidence — Block 12 Wave A: AI insights layer ("Why this reorder")

**Date:** 2026-06-14
**Phase:** 6 (Features)
**Feature:** AI insights layer (Claude) — FEATURES.md §"AI insights layer (Claude)"

## What was built

The interpreter layer: Claude explains the numbers in plain English, never
generates them. Wave A ships the engine + the "Why this reorder" insight on the
PO detail page.

- `src/lib/insights/prompts.ts` — pure, versioned (`PROMPT_VERSION='v1'`) prompt
  builders (reorder + forecast). Injection-safe: only typed numbers/enums/known
  names interpolated, never free user text. System prompt forbids inventing or
  recomputing any figure; missing facts read as "unknown".
- `src/lib/insights/generate.ts` — server-only. `getReorderInsight`: cache
  lookup on `(tenant, entity_type, entity_id, prompt_version)` → miss → assemble
  facts from PO + primary line + policy + inventory level → `generateText` via
  `gateway('anthropic/claude-sonnet-4.6')` with a `providerOptions.gateway.models`
  fallback chain (`claude-haiku-4.5`, `gpt-5.4`) + `APICallError` 402/429
  handling + token-usage log → cache upsert (idempotent). **Confidence is
  DATA-driven** (computed from fact completeness), never the model's self-report
  — a number never originates in the model.
- `src/lib/insights/actions.ts` — `loadReorderInsight` Server Action, RLS
  existence check then admin generation.
- `src/components/InsightPanel/ReorderInsightPanel.tsx` — client; lazy-loads on
  first view, renders through the canonical `<ClaudeInsight>` (loading → prose →
  confidence) + the cited `model · prompt vN` caption + the <60% low-confidence
  warning. Wired onto the PO detail page below the lines panel.

## Verification (live)
- **Tests:** 554 main pass (+7 insights). Typecheck + biome clean.
  - `tests/insights/prompts.test.ts` — fact interpolation, injection-safety, "unknown" on nulls, data-driven `reorderConfidence` (full > 0.85, sparse < 0.6 floored at 0.3).
  - `tests/insights/cache.test.ts` (DB-real) — a pre-cached insight serves with `cached=true`, no model call.
  - `tests/insights/trust-hierarchy.test.ts` — **the FEATURES acceptance lint: scans every TSX and asserts no `<ClaudeInsight>` wraps a `<StatNumber>`.**
- **Live browser (AI Gateway key in `.env.local`):** seeded a PO (BLT-200, on hand 3, reorder point 20, DOS 4, stockout 62%, ordered 47) and loaded the PO detail page. First view generated live:
  > "Stock is at 3 units with only 4 days of supply remaining, which puts us well below the 20-unit reorder point and leaves us exposed to a 62% stockout risk. Ordering 47 units from Atchafalaya Distributing brings the position back above the reorder threshold and covers the near-term demand gap before we go dry."
  - Every number (3, 4d, 20, 62%, 47) is from the facts — **none invented**. Two sentences, operator tone, no emoji.
  - Caption: `anthropic/claude-sonnet-4.6 · prompt v1` (model + version, FEATURES acceptance). Confidence 90% (data-driven).
  - **Reload → `· cached`**: second view served from the `insights` table, no model call (idempotency proven live).
  - Before the key was added, the same panel degraded gracefully ("Couldn't generate an explanation. The numbers above still stand on their own.") without breaking the page — graceful-degradation path verified too.

## Spec notes / deviations
- **Confidence source:** FEATURES step 2 lists `confidence` in the step return; implemented as DATA-driven (fact completeness) rather than model self-report, to keep "a number never originates in the LLM" honest. The <60% warning fires on sparse data.
- **Panel placement:** rendered inline on the PO detail page rather than the right-rail CONTEXT panel (a layout slot mechanism is its own task). Ticketed.
- **Step-wrapping:** the on-view generation is a cached Server Action (low-latency, synchronous feedback) rather than a durable workflow step; durability matters for batch/background insight generation, ticketed.

## Deferred (ticketed in `_reviews/_tickets.md`)
- "Why this forecast" surface wiring (prompt + facts builder already stubbed in prompts.ts).
- "What changed since last week" insight kind.
- The what-if slider entry point (service level / lead time → "if you do this…").
- Right-rail (vs inline) placement; per-tenant insight cost counter surfaced in admin; model-fallback live drill.
