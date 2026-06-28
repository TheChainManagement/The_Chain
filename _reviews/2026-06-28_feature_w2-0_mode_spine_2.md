# Codex Review — feature_w2-0_mode_spine
**Date:** 2026-06-28 12:31
**Project:** The Chain
**Project type:** MoreTech Product
**Phase:** 6 (Features)
**Unit reviewed:** feature_w2-0_mode_spine
**Review weight:** full
**Skills audited:** (none)
**Reviewer:** Codex CLI (model: gpt-5.4)

---

## What was done

- The additive tenant-mode column is real. [supabase/migrations/20260628120000_w2_operating_mode.sql](/Users/themoreapp/More%20Technologies/projects/the-chain/supabase/migrations/20260628120000_w2_operating_mode.sql:16) creates the `operating_mode` enum and [supabase/migrations/20260628120000_w2_operating_mode.sql](/Users/themoreapp/More%20Technologies/projects/the-chain/supabase/migrations/20260628120000_w2_operating_mode.sql:21) adds `tenants.operating_mode not null default 'distribution'`.
- The new mode registry exists on disk. [src/lib/modes/types.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/modes/types.ts:8) defines the persisted mode union, [src/lib/modes/profiles.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/modes/profiles.ts:13) declares the three profiles, and [src/lib/modes/resolver.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/modes/resolver.ts:14) adds a server-only tenant read.
- The bench chrome really is wired to the tenant mode. [src/app/(app)/layout.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/layout.tsx:72) loads the mode in `BenchGate`, and [src/components/bench/LeftRail.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/components/bench/LeftRail.tsx:40) uses the resolved profile to relabel `/inventory` and show the badge.
- The visible delta is test-backed. [tests/modes/profiles.test.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/tests/modes/profiles.test.ts:5) covers the registry basics, and [tests/modes/left-rail.test.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/tests/modes/left-rail.test.tsx:18) proves the badge text plus the `Inventory` → `Storeroom` / `Stock` relabel.

## What wasn't done

- The approved W2-0 migration spec was not delivered. The contract says “Add now (the entire W2-0 migration)” and then lists `issue_out` / `issue_return`, `stock_movements.demand_ref_type`, `demand_ref_id`, `reason_code`, `locations.location_kind`, and CHECK/app validation in [docs/WAVE2_W2-0_MODE_SPINE_DESIGN.md](/Users/themoreapp/More%20Technologies/projects/the-chain/docs/WAVE2_W2-0_MODE_SPINE_DESIGN.md:207). None of that appears in the shipped migration, which stops at the new tenant column in [supabase/migrations/20260628120000_w2_operating_mode.sql](/Users/themoreapp/More%20Technologies/projects/the-chain/supabase/migrations/20260628120000_w2_operating_mode.sql:16). The base enum is still the old six-value shape in [supabase/migrations/20260530120000_init_extensions_enums.sql](/Users/themoreapp/More%20Technologies/projects/the-chain/supabase/migrations/20260530120000_init_extensions_enums.sql:42).
- The registry is not the design-approved “source of truth” yet. The design says each profile carries `demandSource`, `flowEvents`, `terminology`, `nav`, `policyDefaults`, `uomConventions`, and nullable `extensions` in [docs/WAVE2_W2-0_MODE_SPINE_DESIGN.md](/Users/themoreapp/More%20Technologies/projects/the-chain/docs/WAVE2_W2-0_MODE_SPINE_DESIGN.md:30). The shipped `OperatingProfile` only has `label`, `tagline`, `industries`, `archetype`, `demandNoun`, `navLabels`, and `hiddenNav` in [src/lib/modes/types.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/modes/types.ts:36). That is a nav-label registry, not the flow-semantic spine the design approved.
- The “one resolver, read everywhere” rule was not actually implemented. The contract says `getOperatingProfile(tenant) -> Profile` and “Everything mode-dependent in the app reads the profile through ONE resolver” in [docs/WAVE2_W2-0_MODE_SPINE_DESIGN.md](/Users/themoreapp/More%20Technologies/projects/the-chain/docs/WAVE2_W2-0_MODE_SPINE_DESIGN.md:152). What shipped is split: [src/app/(app)/layout.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/layout.tsx:72) loads only the raw mode, [src/components/bench/LeftRail.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/components/bench/LeftRail.tsx:40) re-resolves the profile client-side, and [src/lib/modes/resolver.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/modes/resolver.ts:26) exposes `loadOperatingProfile()` that nothing uses.

## What can be done better

- Stop pretending `demandNoun` plus `navLabels` is enough. W2-2 is supposed to hang issue-out behavior on this spine, but the current profile shape cannot express demand sources, flow events, terminology families, or extension seams. That means this “source of truth” will need a structural rewrite the minute real mode behavior lands.
- The type duplication is sloppy. [src/lib/modes/types.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/modes/types.ts:18) says `NavHref` must stay in sync with `LeftRail`’s NAV, and [src/components/bench/LeftRail.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/components/bench/LeftRail.tsx:19) hardcodes the second copy. That is manual drift bait for every future nav change.
- Test coverage is too shallow for a load-bearing spine. The new tests prove relabeling, but there is nothing exercising `loadOperatingMode()` error behavior, missing-row fallback, or the `BenchGate` integration path. For a tenant-scoped admin read in the app shell, that gap is weak.

## What was missed

- The repo still contains a direct contract contradiction about storeroom movement types, and this slice did not clean it up. [docs/WAVE2_SCOPE.md](/Users/themoreapp/More%20Technologies/projects/the-chain/docs/WAVE2_SCOPE.md:97) says W2-2 issue/adjust/cycle-count movement types “already exist in the schema.” They do not: the actual enum is still only `sale, receipt, transfer_in, transfer_out, adjustment, cycle_count` in [supabase/migrations/20260530120000_init_extensions_enums.sql](/Users/themoreapp/More%20Technologies/projects/the-chain/supabase/migrations/20260530120000_init_extensions_enums.sql:42). Leaving that lie in the scope doc is how the next build walks into avoidable confusion.
- The design’s reserved food seam was missed in code. The contract explicitly calls out nullable `extensions` for things like lot/expiry/FEFO in [docs/WAVE2_W2-0_MODE_SPINE_DESIGN.md](/Users/themoreapp/More%20Technologies/projects/the-chain/docs/WAVE2_W2-0_MODE_SPINE_DESIGN.md:41), but the shipped profile type has no extension seam at all in [src/lib/modes/types.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/modes/types.ts:36). That is exactly the kind of “we’ll wire it later” shortcut this spine was supposed to prevent.
- The missing-row fallback in [src/lib/modes/resolver.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/modes/resolver.ts:22) quietly turns tenant-row absence into `distribution`. For a bench shell that already verified membership, a missing tenant row is corruption, not a benign default. Silent fallback here will mask a broken tenant state and render the wrong mode instead of surfacing the fault.

---

## Decisions (dispositions mine, per the wave round-1 cadence — 2026-06-28)

**Fixed in-slice (clear correctness / craft):**

- **Resolver missing-row → fail loud.** `loadOperatingMode` now THROWS on an absent tenant row
  (BenchGate already verified membership, so absence is corruption). No silent `distribution`.
- **One resolver + dead code.** The layout now calls `loadOperatingProfile()` and passes the
  resolved `OperatingProfile` to `LeftRail`; the client-side re-resolve is gone and
  `loadOperatingProfile` is the single read path (no unused export).
- **NavHref duplication.** New `src/lib/modes/nav.ts` holds the canonical `NAV_ITEMS`; `NavHref` is
  DERIVED from it and `LeftRail` imports it. One source, no drift.
- **Reserved extension seam.** Added `ModeExtensions` + `OperatingProfile.extensions`; food declares
  `{ expiration: true }`. The food/manufacturing/clinical seam is wired, not "later".
- **Resolver test coverage.** New `tests/modes/resolver.test.ts` exercises success, profile
  resolution, read-error-throws, and missing-row-throws via a mocked admin client. Suite 13/13.
- **Doc contradiction #1 (movement types).** `WAVE2_SCOPE.md` W2-2 corrected: `issue_out` does NOT
  exist; only `adjustment`/`cycle_count` do; W2-2 adds `issue_out`/`issue_return`.
- **Doc contradiction #2 (W2-0 vs W2-2 migration).** `WAVE2_W2-0_MODE_SPINE_DESIGN.md` §10 relabeled
  "Storeroom (W2-2) migration spec" with a scope correction: the W2-0 spine is `operating_mode`
  only; the issue/demand-ref/`location_kind` columns ship with W2-2.

**Disposition — disagree / deliberately deferred (documented, not silently skipped):**

- **"W2-0 migration spec not delivered" (issue_out/demand_ref/location_kind).** NOT shipped now, by
  design: those columns are dead until W2-2 builds issue-out, and §9's build order sequences
  storeroom later. Shipping them now = speculative dead schema. Resolved by correcting the doc that
  mislabeled them W2-0 (above), not by adding unused columns.
- **Full profile shape (`flowEvents`, `demandSource` as movement-type arrays, `policyDefaults`,
  `uomConventions`).** The `extensions` seam + `archetype` (the demand-source at spine altitude) are
  in now. The movement-type-level flow declarations stay for W2-2, where the per-mode flow ADAPTERS
  that read them are implemented and tested — declaring them now would reference unbuilt enums.
- **Live-DB BenchGate integration test.** Deferred: the local Supabase GoTrue auth is environmentally
  broken this session (proven on clean main), so the integration harness can't sign up a tenant. The
  resolver branch tests + RTL memorable cover the behavior; live integration runs in a healthy env.

Gates after fixes: tsc, biome, `check:craft`, modes tests 13/13, `next build` — all green.
