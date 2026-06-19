# Codex Review — block2_wave2b_onboarding_inchain
**Date:** 2026-06-18 19:54
**Project:** The Chain
**Project type:** MoreTech Product
**Phase:** 6 (Features)
**Unit reviewed:** block2_wave2b_onboarding_inchain
**Review weight:** full
**Skills audited:** (none)
**Reviewer:** Codex CLI (model: gpt-5.4)

---

## What was done

- The onboarding route was actually extended so QBO and CSV now render inline on `/onboarding` instead of bouncing straight out to other screens. That is real in [src/app/(app)/onboarding/page.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/onboarding/page.tsx:82), [PathPicker.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/onboarding/PathPicker.tsx:47), [OnboardingQboPanel.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/onboarding/OnboardingQboPanel.tsx:28), and [OnboardingImportPanel.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/onboarding/OnboardingImportPanel.tsx:16).
- The QBO OAuth callback was changed to return an in-progress onboarding tenant back to `/onboarding` and stamp `source_connected_at` when appropriate. That logic exists in [src/app/api/qbo/oauth/callback/route.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/api/qbo/oauth/callback/route.ts:64).
- A small pure helper for QBO phase-to-stage mapping was added and covered by unit tests. See [src/lib/onboarding/state.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/onboarding/state.ts:124) and [tests/onboarding/state.test.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/tests/onboarding/state.test.ts:92).
- There is a real evidence file on disk for this slice at [_reviews/2026-06-18_feature_onboarding_wave2b.md](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-18_feature_onboarding_wave2b.md:1), and it accurately describes the code that was added.

## What wasn't done

- The feature contract still calls for `onboardingWorkflow(tenantId, path)` with a `"use workflow"` orchestrator and `"use step"` I/O, but there is still no onboarding workflow on disk. The code itself still documents this as a deliberate deviation in [src/lib/onboarding/state.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/onboarding/state.ts:15), while `FEATURES.md` still requires it at [FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:128) and [FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:143).
- The workflow-progress requirement is still not delivered. `FEATURES.md` requires run state streamed via `getReadable()` instead of DB polling at [FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:144), but the shipped UI polls server actions from the client in [OnboardingQboPanel.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/onboarding/OnboardingQboPanel.tsx:47) and [CompleteControls.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/onboarding/CompleteControls.tsx:49).
- The required memorable artifact for this push does not exist. `MASTER_PROMPT.md` says the feature is not done without `_reviews/<date>_feature_<name>_memorable.{png,test.ts}` at [MASTER_PROMPT.md](/Users/themoreapp/More%20Technologies/projects/the-chain/MASTER_PROMPT.md:135). There is no `_reviews/2026-06-18_feature_onboarding_wave2b_memorable.test.tsx` and no `_reviews/2026-06-18_feature_onboarding_wave2b_memorable.png` on disk. The evidence file admits this is deferred at [_reviews/2026-06-18_feature_onboarding_wave2b.md](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-18_feature_onboarding_wave2b.md:54).
- The acceptance-test story is still missing. `FEATURES.md` requires end-to-end tests for `pilot-qbo@example.test`, `pilot-csv@example.test`, and `pilot-fresh@example.test`, plus crash/resume proof after `process.exit(0)` at [FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:136) and [FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:137). There is no such test evidence on disk; the evidence file still lists action-layer tests and QBO full-consent acceptance as deferred at [_reviews/2026-06-18_feature_onboarding_wave2b.md](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-18_feature_onboarding_wave2b.md:55).
- The minimum-fields contract is still not delivered. `FEATURES.md` requires enforced minimums and blocks completion until they are met at [FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:138), but the evidence file still lists `minimum_fields_met` as deferred at [_reviews/2026-06-18_feature_onboarding_wave2b.md](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-18_feature_onboarding_wave2b.md:57).

## What can be done better

- Token discipline is still being ignored in the onboarding CSS. `MASTER_PROMPT.md` forbids hardcoded design values at [MASTER_PROMPT.md](/Users/themoreapp/More%20Technologies/projects/the-chain/MASTER_PROMPT.md:17) and [MASTER_PROMPT.md](/Users/themoreapp/More%20Technologies/projects/the-chain/MASTER_PROMPT.md:141), but this slice adds raw `12px`, `9px`, `11px`, `1px`, and `2px` values in [src/app/(app)/onboarding/onboarding.module.css](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/onboarding/onboarding.module.css:207), [onboarding.module.css](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/onboarding/onboarding.module.css:216), [onboarding.module.css](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/onboarding/onboarding.module.css:254), and [onboarding.module.css](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/onboarding/onboarding.module.css:260).
- The accessibility discipline is incomplete. `MASTER_PROMPT.md` requires `:focus-visible` on every interactive element at [MASTER_PROMPT.md](/Users/themoreapp/More%20Technologies/projects/the-chain/MASTER_PROMPT.md:30). This stylesheet only defines focus treatment for `.pathCard` and `.input` per `rg`, while the new interactive controls `.continueLink`, `.skipLink`, `.skipYes`, and `.skipNo` have no focus-visible treatment in [onboarding.module.css](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/onboarding/onboarding.module.css:251) and [onboarding.module.css](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/onboarding/onboarding.module.css:280).
- The evidence file overstates the QBO verification. It says “BUILT + live-verified” at [_reviews/2026-06-18_feature_onboarding_wave2b.md](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-18_feature_onboarding_wave2b.md:4), but the QBO section explicitly stops at redirect initiation and punts full consent/sync back to MG at [_reviews/2026-06-18_feature_onboarding_wave2b.md](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-18_feature_onboarding_wave2b.md:45). That is not “live-verified” for the full path; it is partial verification.

## What was missed

- The onboarding chain can lie about supplier completion. `loadOnboardingCounts()` counts all suppliers with no status filter in [src/lib/onboarding/queries.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/onboarding/queries.ts:24), and `resolveOnboarding()` marks suppliers done from any supplier count in [src/lib/onboarding/state.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/onboarding/state.ts:93). But `completeOnboarding()` only accepts `status='active'` suppliers in [src/app/(app)/onboarding/actions.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/onboarding/actions.ts:176). Result: the chain can advance to Forecast and then hard-fail when the operator clicks “Run my first forecast.”
- The minimum-field requirement is not just deferred; the current surfaces make it impossible. Fresh-path product validation only requires SKU and name in [src/lib/inventory/transform.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/inventory/transform.ts:299), fresh-path supplier validation makes lead time optional in [src/lib/suppliers/transform.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/suppliers/transform.ts:253), and there is no onboarding capture of `product_suppliers.unit_cost` at all.
- The CSV path also cannot satisfy the required minimum-field set. The inline onboarding import only exposes `product`, `supplier`, and `stock_movement` specs in [src/app/(app)/onboarding/page.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/onboarding/page.tsx:62), and the import system itself only defines those three kinds in [src/lib/import/field-specs.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/import/field-specs.ts:20) and [field-specs.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/import/field-specs.ts:183). There is no `product_supplier` import lane, so the acceptance requirement for `product_supplier links require unit_cost + lead_time_days` in [FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:138) is currently unreachable for the CSV path.
- The old memorable artifact is being used as cover for a new slice that changed behavior. The only onboarding memorable test on disk is the older jsdom artifact at [_reviews/2026-06-17_feature_onboarding_chain_memorable.test.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-17_feature_onboarding_chain_memorable.test.tsx:39). It renders `OnboardingChain` in isolation; it does not drive the new Wave 2b inline QBO/CSV flow at all. That means the required visible-craft proof for this specific push is absent, not merely delayed.

---

## Decisions (captured 2026-06-18, MG-cadence)

### Fixed in-slice
- **Chain-lies-then-hard-fails bug (real):** `loadOnboardingCounts` now counts only
  `status='active'` suppliers, matching `completeOnboarding`'s gate — the Suppliers
  link can no longer light (and advance to Forecast) on an archived-only supplier.
- **a11y `:focus-visible`** added to `.continueLink` and the `.skip*` controls
  (MASTER_PROMPT requires it on every interactive element).
- **Memorable artifact for 2b:** extracted `QboPhaseTracker` (presentational) +
  `_reviews/2026-06-18_feature_onboarding_inchain_memorable.test.tsx` driving the
  live phase lighting (Catalog → Suppliers → Sales) over the real `qboPhaseStage`.
- **Evidence accuracy:** softened the QBO "live-verified" wording — CSV is full
  end-to-end; QBO is connect-initiation + MG-consent acceptance.

### Pushed back (documented decisions / standing dispositions)
- **`onboardingWorkflow` orchestrator + `getReadable()` streaming:** MG-approved
  state-machine deviation; no block in the app uses `getReadable` (cron/import/QBO
  all poll `sync_runs`). Cross-cutting, not this slice.
- **Minimum-fields / unit cost / required lead time:** MG decision (Wave 2a) — keep
  functional minimums; the engine needs no unit cost (Block 9 no-cost-params) and
  lead time is honestly optional (policy skips no-lead-time SKUs).
- **raw-px → tokens:** standing stack-audit ticket (house style for type; dot/border
  px consistent with every prior block).

### Ticketed
- Acceptance E2E tests (pilot-qbo/csv/fresh) + crash/resume proof.
- `product_supplier` CSV import lane (links are created via the fresh-path RPC /
  QBO sync today; a CSV link lane is a separate feature).
