# Codex Review — block2_wave2a_onboarding
**Date:** 2026-06-17 20:32
**Project:** The Chain
**Project type:** MoreTech Product
**Phase:** 6 (Features)
**Unit reviewed:** block2_wave2a_onboarding
**Review weight:** full
**Skills audited:** (none)
**Reviewer:** Codex CLI (model: gpt-5.4)

---

## What was done

- A real onboarding route exists at [page.tsx](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/onboarding/page.tsx:29>) backed by RLS reads in [queries.ts](</Users/themoreapp/More Technologies/projects/the-chain/src/lib/onboarding/queries.ts:9>) and a pure step-machine in [state.ts](</Users/themoreapp/More Technologies/projects/the-chain/src/lib/onboarding/state.ts:82>). The chain UI and fresh-path panels are on disk in [OnboardingChain.tsx](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/onboarding/OnboardingChain.tsx:15>), [PathPicker.tsx](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/onboarding/PathPicker.tsx:46>), [FirstProductForm.tsx](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/onboarding/FirstProductForm.tsx:24>), [FirstSupplierForm.tsx](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/onboarding/FirstSupplierForm.tsx:24>), [CompleteControls.tsx](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/onboarding/CompleteControls.tsx:20>), and [SkipSetup.tsx](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/onboarding/SkipSetup.tsx:11>).
- The action layer exists in [actions.ts](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/onboarding/actions.ts:53>) for path picking, first product, first supplier, forecast kickoff, completion, and seed-only bypass.
- The auth and dashboard edges were wired: signup now pushes to onboarding in [AuthForm.tsx](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(auth)/AuthForm.tsx:65>), and incomplete tenants are redirected off `/today` in [today/page.tsx](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/today/page.tsx:67>).
- There is limited evidence on disk: unit coverage for the pure step-machine in [tests/onboarding/state.test.ts](</Users/themoreapp/More Technologies/projects/the-chain/tests/onboarding/state.test.ts:28>), a jsdom memorable-artifact render test in [_reviews/2026-06-17_feature_onboarding_chain_memorable.test.tsx](</Users/themoreapp/More Technologies/projects/the-chain/_reviews/2026-06-17_feature_onboarding_chain_memorable.test.tsx:39>), and the tranche note in [_reviews/2026-06-17_block2-wave2a-onboarding.md](</Users/themoreapp/More Technologies/projects/the-chain/_reviews/2026-06-17_block2-wave2a-onboarding.md:1>).

## What wasn't done

- The feature contract’s `onboardingWorkflow` was not built. There is no onboarding workflow file, no `"use workflow"` orchestration, no `createHook`, and no streamed `getReadable()` client progress. The evidence file explicitly admits the deviation at [_reviews/2026-06-17_block2-wave2a-onboarding.md](</Users/themoreapp/More Technologies/projects/the-chain/_reviews/2026-06-17_block2-wave2a-onboarding.md:16>).
- The QBO and CSV paths are not end-to-end onboarding implementations. The picker just records the path and punts to `/integrations/quickbooks` or `/import` in [PathPicker.tsx](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/onboarding/PathPicker.tsx:62>); the evidence file says live in-chain sync progress is deferred at [_reviews/2026-06-17_block2-wave2a-onboarding.md](</Users/themoreapp/More Technologies/projects/the-chain/_reviews/2026-06-17_block2-wave2a-onboarding.md:22>).
- The acceptance-test story for onboarding is missing. There are no action-layer integration tests, no `pilot-qbo@example.test` / `pilot-csv@example.test` / `pilot-fresh@example.test` flows, and no crash-resume proof. The evidence file tickets those absences at [_reviews/2026-06-17_block2-wave2a-onboarding.md](</Users/themoreapp/More Technologies/projects/the-chain/_reviews/2026-06-17_block2-wave2a-onboarding.md:87>).
- The required Playwright artifact is not here. What exists is a jsdom render test in [_reviews/2026-06-17_feature_onboarding_chain_memorable.test.tsx](</Users/themoreapp/More Technologies/projects/the-chain/_reviews/2026-06-17_feature_onboarding_chain_memorable.test.tsx:1>), and the evidence file openly says the Playwright capture is still deferred at [_reviews/2026-06-17_block2-wave2a-onboarding.md](</Users/themoreapp/More Technologies/projects/the-chain/_reviews/2026-06-17_block2-wave2a-onboarding.md:89>).
- The canonical feature evidence file is missing. The contract wants `_reviews/<date>_feature_<name>.md`; on disk there is only `_reviews/2026-06-17_block2-wave2a-onboarding.md`.

## What can be done better

- Stop writing “tokens only” while violating token discipline. [onboarding.module.css](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/onboarding/onboarding.module.css:1>) hardcodes font sizes, paddings, outlines, breakpoints, a `translateY(-1px)`, and an inline `box-shadow` by raw pixel values at [line 38](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/onboarding/onboarding.module.css:38>), [line 41](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/onboarding/onboarding.module.css:41>), [line 51](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/onboarding/onboarding.module.css:51>), [line 69](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/onboarding/onboarding.module.css:69>), [line 113](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/onboarding/onboarding.module.css:113>), and [line 119](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/onboarding/onboarding.module.css:119>).
- The focus hierarchy is off-spec. Neutral-surface path cards use a deep-slate outline in [onboarding.module.css](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/onboarding/onboarding.module.css:40>) even though the project rule says neutral surfaces get cobalt focus treatment.
- The memorable proof is too fake to carry trust. The artifact only renders `OnboardingChain` in isolation in [_reviews/2026-06-17_feature_onboarding_chain_memorable.test.tsx](</Users/themoreapp/More Technologies/projects/the-chain/_reviews/2026-06-17_feature_onboarding_chain_memorable.test.tsx:39>); it never drives the real signup morph, path selection, form submissions, forecast kick, or redirect.

## What was missed

- The onboarding mutations are not atomic and they ignore downstream write failures. [createFirstProduct](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/onboarding/actions.ts:135>) inserts the product, then best-effort provisions location/inventory at [line 151](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/onboarding/actions.ts:151>), then stamps `catalog_minimum_met_at` at [line 161](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/onboarding/actions.ts:161>) without checking any of those later writes. [createFirstSupplier](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/onboarding/actions.ts:192>) does the same with the supplier link RPC at [line 219](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/onboarding/actions.ts:219>) and the supplier-minimum stamp at [line 229](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/onboarding/actions.ts:229>). That directly violates the “no partial-state tenants” acceptance rule.
- The minimum-field contract is not enforced at all. The product form only asks for SKU, name, optional opening qty, and optional UoM in [FirstProductForm.tsx](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/onboarding/FirstProductForm.tsx:33>); `validateProductInput()` only validates SKU and name in [inventory/transform.ts](</Users/themoreapp/More Technologies/projects/the-chain/src/lib/inventory/transform.ts:299>). There is no product unit cost anywhere. The supplier form makes lead time optional in [FirstSupplierForm.tsx](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/onboarding/FirstSupplierForm.tsx:44>), `validateSupplierInput()` only requires name in [suppliers/transform.ts](</Users/themoreapp/More Technologies/projects/the-chain/src/lib/suppliers/transform.ts:253>), and the onboarding link RPC writes `p_unit_cost: null` at [actions.ts](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/onboarding/actions.ts:222>). That is a straight miss against the feature’s required minimums.
- Completion gating is too weak and can mark bad data as “done.” [completeOnboarding()](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/onboarding/actions.ts:247>) checks only product count and supplier count, and the supplier count is not even filtered to active rows at [line 254](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/onboarding/actions.ts:254>). A tenant can satisfy onboarding with an archived supplier, no unit cost, no guaranteed supplier link, and no enforced lead time.
- The code intentionally clears supplier minimums even when the source-of-supply edge does not exist. The comment at [actions.ts](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/onboarding/actions.ts:208>) says missing product/link failure must not block clearing the minimum. That is the opposite of the feature contract, which requires the product-supplier minimum fields before completion.

---

## Decisions (captured 2026-06-18, MG)

### Atomicity / "no partial-state tenants"
- **Decision:** Build the atomic RPC now.
- **Action:** Added migration `20260618120000_block2_onboarding_rpcs.sql` — SECURITY
  INVOKER `onboarding_seed_first_product` (product + "Main" location + opening level +
  catalog stamp) and `onboarding_seed_first_supplier` (supplier + primary link +
  supplier stamp), each one transaction (rolls back as a unit; raises if no product
  exists before a supplier). Actions now call the RPCs. Hosted-applied via Supabase
  MCP; advisors clean (same 4 pre-existing WARNs, ZERO new — SECURITY INVOKER adds
  none). Re-verified live (tenant Atomic RPC Co): Main/warehouse location, on_hand
  200, primary link lead=14, completed → /today, 0 console errors.

### Minimum-field enforcement (unit cost / lead time / minimum_fields_met)
- **Decision:** Keep functional minimums, ticket the rest.
- **Action:** Kept SKU+name / supplier-name minimums (engine needs no unit cost per
  Block 9's no-cost-params design; lead time honestly optional — policy skips
  no-lead-time SKUs). Ticketed populating `minimum_fields_met` jsonb in `_tickets.md`.

### Fixed in-slice (no question needed)
- Silent downstream-write failures → now surfaced (superseded by the atomic RPCs).
- Completion gate filters suppliers to `status='active'`.
- Path cards now use a cobalt focus ring (neutral-surface rule).
- Evidence renamed to the canonical `_reviews/2026-06-17_feature_onboarding.md`.

### Confirmed-deferred (MG's earlier scope calls) — ticketed
- Formal `onboardingWorkflow`; QBO/CSV in-chain sync streaming (Wave 2b); action-layer
  integration tests; Playwright 3-state capture (infra-blocked, RTL artifact stands in).
