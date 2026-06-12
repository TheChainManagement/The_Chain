# Codex Review — block9_inventory_policy
**Date:** 2026-06-12 14:14
**Project:** The Chain
**Project type:** MoreTech Product
**Phase:** 6 (Features)
**Unit reviewed:** block9_inventory_policy
**Review weight:** full
**Skills audited:** moretech-codex-review
**Reviewer:** Codex CLI (model: gpt-5.4)

---

## What was done

- The policy math exists and is not fake. `src/lib/policy/compute.ts:126-240` implements band-derived demand stats, service-level clamping, safety stock, ROP, ROQ, DOS, stockout risk, and supplier-vs-scorecard lead-time choice.
- Policy derivation is wired into both batch and single-SKU recompute paths. See `src/lib/policy/derive.ts:78-273`, `src/workflows/forecast-batch.ts:286-349`, and `src/app/(app)/forecasts/actions.ts:142-179`.
- The SKU detail policy panel and the what-if bench are on disk. See `src/app/(app)/inventory/[productId]/page.tsx:159-253`, `src/app/(app)/inventory/policy/page.tsx:21-111`, and `src/app/(app)/inventory/policy/WhatIfBench.tsx:29-229`.
- There is real test evidence for the math, the save action, the derivation path, and the memorable bench interaction: `tests/policy/compute.test.ts`, `tests/policy/save-action.test.ts`, `tests/forecast/batch-core.test.ts:586-701`, and `_reviews/2026-06-12_feature_policy_whatif_memorable.test.tsx:69-127`.
- The claimed review artifact is on disk at `_reviews/2026-06-12_block9-inventory-policy.md`. The supplied compliance block saying it is missing was not verified against the repo.

## What wasn't done

- `/inventory/policy` shipped without a route-local loading state. The folder contains only `page.tsx`, `WhatIfBench.tsx`, `actions.ts`, and `policy.module.css`; there is no `loading.tsx`.
- The dangerous read-model layer was not tested. There is coverage for compute/save/derivation, but nothing for `src/lib/policy/queries.ts` or `src/lib/policy/whatif.ts`, which is exactly where the selection bugs live.
- The compliance audit itself was not done carefully. It claims `_reviews/<YYYY-MM-DD>_<unit>.md` is missing, but `_reviews/2026-06-12_block9-inventory-policy.md` exists.

## What can be done better

- Stop letting the bench pick a location implicitly. `loadWhatIfInputs()` does `.limit(1)` on `inventory_policy` with no ordering in `src/lib/policy/whatif.ts:60-71`, and `page.tsx` only selects by `product` in `src/app/(app)/inventory/policy/page.tsx:29-32`. Make location an explicit route/input dimension.
- Fix the responsive layout. `src/app/(app)/inventory/policy/policy.module.css:24-28` hardcodes three lever columns, `:104-115` hardcodes a five-cell ribbon, and `:177-183` hardcodes fixed ledger tracks. There are no mobile overrides in the file.
- Don’t recompute the lead-time source label at read time. `src/lib/policy/queries.ts:73-81,95-126` derives one current `leadTimeSource` for the whole product instead of reading the source that produced each stored row. That label can drift away from the actual policy row.

## What was missed

- Multi-location behavior is broken on the bench. `listPolicies()` returns one row per `inventory_policy` row in `src/lib/policy/whatif.ts:196-223`, but the UI treats them as SKU rows: the header says `${ledger.length} SKUs under policy` and each list item is keyed only by `row.productId` in `src/app/(app)/inventory/policy/page.tsx:68-75`. With multiple locations, counts are wrong and React keys collide.
- Clicking a ledger row cannot target a specific location. The link only passes `?product=${row.productId}` in `src/app/(app)/inventory/policy/page.tsx:72-75`, then `loadWhatIfInputs()` grabs an arbitrary policy row via `.limit(1)` in `src/lib/policy/whatif.ts:60-71`. That means the bench can display one location and save the service level for another.
- The test suite missed the exact edge case the feature claims to support. The memorable artifact is single-location only (`_reviews/2026-06-12_feature_policy_whatif_memorable.test.tsx:30-61`), and the derivation integration uses one seeded `locationId` (`tests/forecast/batch-core.test.ts:603-610`). No test exercises duplicate policy rows, location picking, or bench saves in a multi-location SKU.

## Decisions (captured 2026-06-12, dispositioned by Claude per the standing wave cadence — MG to confirm at the session checkpoint)

### Multi-location broken on the bench (colliding keys, untargetable locations, arbitrary .limit(1) pick)
- **Decision:** fix now — REAL bug, exactly the wired-for-full-vision dimension.
- **Action:** location is now an explicit dimension end to end: ledger rows carry (product, location) keys + names and link with `&location=`; `loadWhatIfInputs` targets the requested location (untargeted pick is deterministic by lowest location_id, not arbitrary); the bench title shows the location when a tenant is multi-location; counts read "N policies across M SKUs". Integration test seeds a second location and proves per-location rows, targeting, positions, and the deterministic fallback.

### Lead-time source label recomputed at read time (drift risk)
- **Decision:** fix now, at the root.
- **Action:** migration `20260612150000` adds `inventory_policy.lead_time_source` (checked 'supplier'/'scorecard'); the deriver stores the choice it actually made; the read model only reads it (pre-migration rows default 'supplier'). The read-time recompute helper is deleted.

### `/inventory/policy` missing loading.tsx
- **Decision:** fix now (the standard established this session).
- **Action:** ribbon-shaped shimmer loading state added.

### No mobile overrides on the bench
- **Decision:** fix now — responsive @720px IS house pattern (purchase-orders, suppliers, bench.module all carry it; the review was right and my "cockpit mode" instinct wrong).
- **Action:** levers stack to one column, ribbon to two, ledger collapses, at the same 720px breakpoint the other cockpits use.

### Read-model layer untested (queries.ts / whatif.ts)
- **Decision:** fix now.
- **Action:** integration coverage added for `loadProductPolicies` (stored source on every row), `listPolicies` (per-location entries, distinct keys), and `loadWhatIfInputs` (targeting + positions + deterministic fallback).

### Compliance audit false-miss of its own review document
- **Decision:** fix now — in the PLUGIN, root cause.
- **Action:** the audit checks artifacts BEFORE the run writes the review doc, so it always flagged its own output missing. The registry now marks the review doc with the `?` optional prefix and states it is produced by the run itself.

### Memorable artifact is RTL, not Playwright
- **Decision:** standing pushback (infra-blocked since Block 5); RTL + the live in-browser scrub (recorded in the evidence: SS 10.2→13.9 etc.) remain the accepted standard.
