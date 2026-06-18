# Block 2 Wave 2a — Tenant onboarding (fresh path + shell)

Date: 2026-06-17
Commit range: (pending push)
Status: BUILT + live-verified. Codex gate + MG checkpoint pending.

## What shipped

The guided first-run workflow. The five-link chain the sign-up morph ignites
(Account → Source → Catalog → Suppliers → Forecast) now **persists** at
`/onboarding` and goes live: each link lights cobalt from real `onboarding_state`
+ live counts as the operator completes a step. By the time they reach `/today`
they already know the chain metaphor.

### Architecture (MG-approved 2026-06-17)
- **State-machine + reuse**, NOT a formal `onboardingWorkflow` orchestrator.
  Onboarding is user-paced clicks across surfaces that already exist; the only
  truly async job (the first forecast) is already its own durable workflow. So
  the flow is driven by `onboarding_state` + a pure step-machine, and completion
  **reuses** `runForecastBatch` → `forecastTenantBatchWorkflow`. **FEATURES
  deviation, flagged here.**
- **Fresh path + shell first** (Wave 2a). QBO/CSV paths set the path and hand off
  to the existing `/integrations/quickbooks` and `/import` surfaces; the chain
  still tracks their catalog/supplier minimums from live counts. In-chain sync
  progress streaming is Wave 2b.

### Files
- `src/lib/onboarding/state.ts` — pure step-machine (`resolveOnboarding`,
  `onboardingComplete`). Belt-and-suspenders done-ness (stamp OR live count),
  monotonic link assignment (no gaps).
- `src/lib/onboarding/queries.ts` — RLS reads (`loadOnboardingState`,
  `loadOnboardingCounts`).
- `src/app/(app)/onboarding/actions.ts` — `pickPath`, `createFirstProduct`
  (+ "Main" location + opening inventory level + catalog stamp),
  `createFirstSupplier` (+ primary link to first product + supplier stamp),
  `completeOnboarding` (minimums-gated batch kick), `finishOnboarding`
  (stamps completed_at once first forecast lands), `seedOnlyOptIn` (owner-gated,
  audit-logged bypass).
- `src/app/(app)/onboarding/page.tsx` — server orchestration; redirects a
  completed/legacy tenant to `/today`.
- Components: `OnboardingChain` (presentational, the memorable element),
  `PathPicker`, `FirstProductForm`, `FirstSupplierForm`, `CompleteControls`
  (kick → poll → "preparing your workshop" shimmer → land), `SkipSetup`.
- `onboarding.module.css` — tokens only, reduced-motion-safe shimmer, responsive.
- Routing: sign-up morph now navigates to `/onboarding` (was `/today`);
  `/today` guards an incomplete tenant back to `/onboarding`.

Migration `20260618120000_block2_onboarding_rpcs.sql` (added in the Codex pass) —
two SECURITY INVOKER RPCs that make each fresh-path step atomic (see Post-Codex
update below). `onboarding_state` + all its columns already existed in the
Foundation; `first_forecast_ready_at` is already stamped by the forecast batch.

## Post-Codex update (2026-06-18)
Codex review `_reviews/2026-06-17_block2_wave2a_onboarding.md` (gpt-5.4, Phase-6
full). MG decisions captured in that file's Decisions section. In-slice changes:
- **Atomic RPCs** (`onboarding_seed_first_product`, `onboarding_seed_first_supplier`):
  each fresh-path step now writes in one transaction (product+location+level+stamp;
  supplier+primary-link+stamp), rolling back as a unit — closes the "no partial-state
  tenants" finding. Hosted-applied (Supabase MCP), advisors clean (4 pre-existing
  WARNs, zero new). Re-verified live (Atomic RPC Co): Main location, on_hand 200,
  primary link lead=14, completed → /today.
- Completion gate filters suppliers to `status='active'`; path cards use a cobalt
  focus ring (neutral-surface rule); evidence renamed to the `_feature_` convention.
- Functional minimums kept (engine needs no unit cost; lead time optional);
  `minimum_fields_met` population, action-layer tests, and the Wave-2b items ticketed.

## Tests
- `tests/onboarding/state.test.ts` — 14 cases: per-link done predicates, live-
  count fallback, monotonic clamp, qbo source-not-connected, legacy-complete guard.
- `_reviews/2026-06-17_feature_onboarding_chain_memorable.test.tsx` — the required
  visible artifact: the chain rendered in three states (empty 1/5 → 2/5 → full
  5/5), asserting one ignited frontier link and the cobalt connector advancing.
- Updated `tests/dashboard/suppression.test.tsx` to stub the new onboarding read.
- **Suite 606/606**, typecheck + biome + `next build` clean.

## Live verification (dev :3100, local Supabase + forecast :8787)

**Happy fresh path** (tenant `Onboarding Verify Co`):
sign-up → morph → `/onboarding` (chain 1/5, Source active) → pick "starting fresh"
(2/5, Catalog active) → first product OVC-1001 on_hand 120 (3/5, Suppliers active)
→ first supplier Bayou Supply Co (4/5, Forecast active) → "Run my first forecast"
(shimmer) → batch completes → redirect to `/today`. Zero console errors.
DB: `path=fresh`, all minimums + first_forecast + completed_at set, seed_only=f,
1 product / 1 supplier / location "Main" / inventory_level on_hand=120 /
product_suppliers primary=t / sync_run completed forecast_batch / 1 forecast.

**Reverse guard:** completed tenant navigating to `/onboarding` → redirected to
`/today`.

**Seed-only bypass** (tenant `Skip Path Co`): skip-before-path → `/today` empty
bench. DB: `path=fresh` (default), completed_at + seed_only=t, 0 products, audit
row `onboarding.seed_only_bypass` written.

### Bug caught live + fixed in-slice
`seedOnlyOptIn` originally did an `UPDATE`, but a user can skip BEFORE picking a
path — so no `onboarding_state` row exists yet, the update hit 0 rows,
`completed_at` never landed, and the `/today` guard bounced the user straight back
to `/onboarding` (infinite loop). It also audit-logged a bypass that hadn't taken.
Fixed: `seedOnlyOptIn` now **upserts** (preserving a chosen path, else `fresh`)
and only audit-logs after the write lands. Re-verified live: skip now reaches
`/today` and the bypass is recorded.

## Deferred / ticketed
- Wave 2b: QBO/CSV in-chain live sync progress (consume the workflow run stream
  inside the chain); the 3-state Playwright capture (infra-blocked, RTL artifact
  stands in).
- Action-layer integration test for the onboarding actions (incl. the skip-before-
  path regression) — consistent with prior blocks where action-layer tests are
  ticketed; the bug is covered by live verification this session.
- LeftRail intentionally not given an /onboarding entry (transient flow).
