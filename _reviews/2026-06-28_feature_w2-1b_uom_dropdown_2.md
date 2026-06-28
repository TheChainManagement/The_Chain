# Codex Review — feature_w2-1b_uom_dropdown
**Date:** 2026-06-28 13:54
**Project:** The Chain
**Project type:** MoreTech Product
**Phase:** 6 (Features)
**Unit reviewed:** feature_w2-1b_uom_dropdown
**Review weight:** full
**Skills audited:** (none)
**Reviewer:** Codex CLI (model: gpt-5.4)

---

## What was done

- The core slice exists on disk. `src/lib/uom/units.ts:18-66` adds a 20-unit curated reference plus `isKnownUom`, `uomLabel`, and `uomOptionGroups`.
- The new picker is real. `src/components/UomPicker/UomPicker.tsx:19-68` implements the categorized `<select>`, the `Other…` branch, and the hidden `unit_of_measure` input contract.
- It was wired into the three claimed forms: `src/app/(app)/inventory/AddSku.tsx:76-79`, `src/app/(app)/inventory/[productId]/SkuActions.tsx:127-130`, and `src/app/(app)/onboarding/FirstProductForm.tsx:62-65`. The product detail page was also updated to use `uomLabel` at `src/app/(app)/inventory/[productId]/page.tsx:374`.
- The two UoM test files exist and are meaningful. `tests/uom/units.test.ts:4-37` covers the pure helpers; `tests/uom/uom-picker.test.tsx:18-53` covers curated selection, `Other`, and default round-trip. I reran those targeted tests and got `8 passed`.

## What wasn't done

- The screenshot gate was skipped. `docs/WAVE2_SCOPE.md:83` says each Wave 2 build goes through “build, screenshot, MG review, code review, push,” and the evidence file explicitly says the live browser screenshot was blocked by auth at `_reviews/2026-06-28_feature_w2-1b_uom_dropdown.md:36-39`. There is no screenshot artifact on disk for this slice.

## What can be done better

- This is not actually a data-model cleanup yet; it is a manual-entry cleanup only. Manual forms now write curated codes, but other product write paths still persist arbitrary strings straight into the same column: `src/lib/import/commit.ts:215-223`, `src/lib/import/durable-commit.ts:172-180`, `src/lib/qbo/sync-core.ts:188-200`, and `src/lib/qbo/incremental-core.ts:179-200`. That leaves `unit_of_measure` semantically mixed forever.
- Display normalization is scattered instead of centralized. `uomLabel` exists, but only the product detail view uses it (`src/app/(app)/inventory/[productId]/page.tsx:374`). The inventory mapping layer still passes raw values through unchanged at `src/lib/inventory/transform.ts:164-176` and `179-190`. This should have been handled at a shared read boundary, not as a one-off page fix.
- The test coverage is too local. The memorable test proves `UomPicker` in isolation, not that the real Add SKU / Edit SKU / onboarding forms submit and persist the intended value end to end. For a form-contract change, that is thin.

## What was missed

- The inventory list now diverges from the detail page. New manual products will store abbreviated codes like `ea` and `kg`, but `src/app/(app)/inventory/InventoryLedger.tsx:123-126` renders `row.unitOfMeasure` raw. The detail page translates with `uomLabel`; the main catalog surface does not. That is a user-visible inconsistency introduced by this slice.
- There is no bridge for obvious legacy values. Existing repo fixtures already use free-text `each` at `tests/inventory/transform.test.ts:27` and `:84`, but `isKnownUom` is exact-match only (`src/lib/uom/units.ts:43-45`), `uomLabel` only translates exact curated codes (`src/lib/uom/units.ts:52-55`), and `UomPicker` sends any non-exact default into `Other` (`src/components/UomPicker/UomPicker.tsx:28-30`). So editing a legacy `each` record does not round-trip into the curated picker; it falls back to custom text. For a W2-1 “data-model cleanup” feature, that normalization gap is the obvious missed edge case.

---

## Decisions (dispositions mine, per the wave round-1 cadence — 2026-06-28)

**Fixed in-slice:**
- **Legacy round-trip (What was missed #2).** Added `aliases` to every unit + a `resolveUomCode`
  resolver. `each`/`Box`/`kilogram`/case-variants now resolve to a curated code, so editing a legacy
  record snaps to the curated unit (and saving normalizes it) instead of falling into "Other".
- **List/detail divergence (What was missed #1).** `InventoryLedger` now renders `uomLabel`, matching
  the detail page — both show "Each", not a raw `ea`. With the resolver, legacy free-text also
  displays as the friendly label everywhere.
- Tests extended for alias resolution + the legacy→curated picker round-trip (10/10).

**Accepted / deferred (documented, not silent):**
- **Ingest write paths keep source strings (What can be better #1).** CSV/QBO bring the source's UoM
  text; the display + edit layer now normalizes it (via `resolveUomCode`/`uomLabel`), so surfaces are
  consistent. Storing the canonical code on ingest is behavior-changing on import — ticketed in
  `_reviews/_tickets.md` (Wave 2), not forced into this slice.
- **Screenshot gate + end-to-end form-persist test (What wasn't done / What can be better #3).**
  Blocked by the local GoTrue auth breakage this session (can't sign in to a product form). The RTL
  memorable test renders the real picker and asserts the submitted-value contract; the picker
  compiles into all three forms in the production build. Capture on a healthy env / Preview.

Gates after fixes: tsc, biome, `check:craft`, `next build`, uom tests 10/10 — all green.
