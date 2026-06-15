# Block 12 Wave B3 — what-if slider interpretation — evidence

**Date:** 2026-06-14
**Scope:** Claude's "If you do this, here's what changes" read on the policy
what-if bench (`/inventory/policy`). Third and final Wave B slice (B1 forecast +
B2 weekly digest shipped earlier today). Completes FEATURES step 5.

## What shipped
- **`deriveScenario(inputs, selection)`** (pure, `lib/policy/whatif.ts`) — extracted
  the supplier/lead resolution + `derivePolicy` call into ONE place. The bench's
  instant client-side ripple AND the server-side insight facts now run the same
  function, so they can never drift. The client `WhatIfBench` was refactored to use
  it (no behaviour change).
- **`policy_whatif` insight kind** — `PolicyWhatIfFacts` (sku, supplier, before/after
  service level, lead time, **safety stock + reorder point**) + `buildPolicyWhatIfPrompt`.
  SKU + supplier pass through `safeLabel`.
- **`explainWhatIf` Server Action** (`/inventory/policy/actions.ts`) — re-derives
  BOTH the saved baseline and the scrubbed scenario **server-side** via `deriveScenario`,
  so Claude narrates engine numbers, never client-asserted ones. Read-only (no role gate).
- **`getPolicyWhatIfInsight` + `whatIfScenarioId`** — the scenario's cache identity is
  a deterministic hash of (product, location, rounded scenario params) via the shared
  `stableUuid` (refactored out of `weeklyPeriodId`). Identical scenarios reuse the
  cached note — no repeat model spend; any change generates fresh.
- **Bench UI** — an "Explain this what-if" button appears only when the scenario
  differs from the saved policy; clicking loads the read into a `<ClaudeInsight>`.
  A loaded note clears the moment any lever moves (no stale read under fresh numbers).

## Two craft decisions made during verification
1. **Dropped stockout risk from the what-if facts.** First live run, the model
   second-guessed itself ("— wait, that's backwards"). Cause was real: this engine's
   stockout risk is `P(D_LT > position − safety stock)`, so raising the service level
   raises that number (bigger buffer relative to current position). Counterintuitive in
   a what-if. Removed it — the trade-off is now cleanly safety stock + reorder point
   ("more protection vs. more carried stock"), which is correct and intuitive.
2. **Added a "Saved · …" baseline reference on the bench.** The insight cites the
   baseline ("from") numbers, which weren't otherwise on screen (the ribbon shows the
   scenario). Now `Saved · 95.0% · safety stock 7.7 · reorder point 42.7` renders above
   the note — every number Claude cites is visible. Trust hierarchy fully grounded.

## Tests
- `tests/policy/whatif.test.ts`: `deriveScenario` matches a direct `derivePolicy` call
  for baseline + lead override; supplier select + fallback.
- `prompts.test.ts`: before→after trade-off framing; supplier named only on a swap +
  neutralized; `whatIfScenarioId` deterministic + distinct + valid uuid.
- `cache.test.ts`: `getPolicyWhatIfInsight` serves a pre-cached scenario with no model call.
- **Suite 573/573**, `tsc` clean, biome clean, **`next build` clean** (server-only
  boundaries verified — the client bench imports the action + type-only `InsightView`).

## Live verification (local, real AI Gateway key)
Seeded a loginable tenant with a full policy (forecast + points + supplier link +
levels), signed in, opened `/inventory/policy`, scrubbed service level 95% → 99%, clicked
Explain:
- *"Moving to 99% service level raises safety stock from 7.7 to 10.9 units because the
  higher z-score demands a larger buffer … which pushes the reorder point up from 42.7 to
  45.9 units. The trade-off is that the extra 3.2 units of carried stock buys meaningfully
  better protection against stockouts, but at the cost of tying up more working capital."*
  Clean trade-off, no self-correction, every number on the bench (ribbon 10.9/45.9 +
  Saved ref 7.7/42.7). 90% confidence, caption `anthropic/claude-sonnet-4.6 · prompt v1`.
- Re-running the identical 99% scenario → `· cached`, no second model call.
- **0 console errors.** Throwaway seed + user deleted; seed script removed.

## Wave B complete
B1 (why this forecast) + B2 (what changed this week) + B3 (what-if interpretation) all
built, live-verified, committed locally. **Next: one batched `moretech-codex-review`
across the three commits, then push.**
