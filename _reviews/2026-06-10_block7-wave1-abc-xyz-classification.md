# Evidence — block7_wave1_abc_xyz_classification

**Date:** 2026-06-10
**Project:** The Chain
**Phase:** 6 (Features) · Block 7 (ABC/XYZ classification) · Tranche C wave 1
**Unit:** ABC/XYZ classification engine + value × variability quadrant cockpit

---

## Goal

First piece of the intelligence engine (Tranche C). Classify every SKU by consumption value (ABC)
and demand variability (XYZ) so the catalog can be triaged, and — critically — compute the ADI the
Block 8 forecast method routing depends on. The build plan ships forecasting + classification as one
mutually-dependent feature; this wave delivers the classification half (no Python yet), and wave 2's
forecast batch reuses the same pure module.

## What was built

1. **Pure math** (`src/lib/classification/compute.ts`): `bucketWeeklyDemand` (52-week demand series
   from signed sale movements, outflow magnitude), `computeXyz` (ADI = periods ÷ periods-with-demand;
   CV² = population variance ÷ mean² of the NON-ZERO demand sizes — Syntetos-Boylan; XYZ bucket by
   `xyz_cuts`), `assignAbc` (Pareto cumulative-value-share split by `abc_cuts`). ADI is stored for
   Block 8 routing, not used for the XYZ bucket.

2. **Engine** (`src/lib/classification/classify.ts`, server): loads active products + primary-supplier
   unit cost (cost basis — no price column exists; cost is the textbook ABC basis anyway) + trailing-
   365d `type='sale'` movements; seeds default thresholds v1 ([0.80,0.95]/[0.5,1.0]/cost) on first
   run; computes per-SKU XYZ + consumption value; ranks ABC across the catalog; replaces the tenant's
   `product_classifications` snapshot (delete-then-insert — no natural unique key to upsert on).
   Tenant-wide (`location_id = null`); the per-location dimension is wired in the schema for later.
   Service-role writes (the table is system-write-only; RLS allows tenant SELECT only).

3. **Trigger** — `recomputeClassifications` Server Action (owner/manager gate), surfaced as a
   **Recompute** button on the cockpit. Wave 2's forecast batch will own the scheduled run.

4. **Cockpit** — `/inventory/classification`: `ClassificationControls` (last-computed + recompute) +
   `QuadrantGrid` (presentational, also used by the gallery) over `loadQuadrant`. The memorable
   element: the 3×3 **value × variability grid** (ABC rows, XYZ cols), the A/B·Z **watch corner**
   (valuable + erratic) lit amber, cells carry count + total value + SKU tiles, plus an
   "awaiting signal" bucket for SKUs ranked by value but with no demand history yet.

5. **`ClassificationBadge`** component (Plex Mono caps, semantic tints — ABC by ink weight, XYZ by
   risk tone X-flow/Y-warn/Z-stop; cobalt reserved for brand, never data). The inventory list + detail
   `ClassificationPanel` (wired since Block 3) now populate; a "Classification" link added to the
   inventory header.

## Tests

- `tests/classification/compute.test.ts` (8): demand bucketing (window + magnitude), XYZ (no-demand
  nulls, smooth X with ADI 1, intermittent high-ADI, erratic multi-value CV²>1 → Z), CV² cutoff
  boundaries, Pareto ABC (cumulative split + zero-total → all C).
- `_reviews/2026-06-10_feature_classification_memorable.test.tsx` (4, CI via the `_reviews` glob):
  renders the real `QuadrantGrid` — both axes labeled, watch corner lit only on populated high-value
  erratic cells (not the empty C·Z), SKU tiles carry the badge, awaiting-signal bucket present.
- Full suite **323 passed / 43 files**. `tsc --noEmit` clean. `biome check src` clean. `next build`
  clean — `/inventory/classification` renders as PPR. No migration (schema was Foundation-complete).

## Visible artifact

`/gallery` Block 7 section: the `ClassificationBadge` in its quadrant tints + the `QuadrantGrid` over
a fixture catalog with the watch corner lit. Captured via Preview MCP, MG-approved 2026-06-10.

## Follow-ups (not this wave)

- **Wave 2 — Block 8 demand forecasting:** Python Fluid `statsforecast` function + `forecastTenantBatchWorkflow`,
  reusing this classification for ADI-based method routing (Croston/SBA/TSB for intermittent).
- **Per-location classification** (column wired; tenant-wide for now).
- **Threshold editor UI** (thresholds are data-driven + versioned; only the default v1 is seeded).
- **Price basis** (cost basis today; no price field exists — wire when one does).
- **Scale:** the recompute runs synchronously in the action; large catalogs move to the forecast
  batch's durable sharding in wave 2.
