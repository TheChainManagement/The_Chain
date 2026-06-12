# Evidence — block9_inventory_policy

**Date:** 2026-06-12
**Project:** The Chain
**Phase:** 6 (Features) · Block 9 (Inventory optimization) · Tranche C
**Unit:** Policy engine (9a) + the what-if bench (9b) — safety stock, ROP, DOS, stockout risk

---

## Goal

Turn promoted forecasts into operating policy: per-SKU safety stock, reorder point, and
recommended quantity derived from the model's OWN uncertainty; Days-of-Supply and
Stockout-Risk as named widgets; and the what-if bench where an operator scrubs service
level / lead time / supplier and watches the whole policy ribbon tick in real time —
Block 9's FEATURES memorable element.

## What was built

### 9a — the engine + shard step + widgets

1. **Pure math (`src/lib/policy/compute.ts`)** — `invNorm` (Acklam, |ε|<1.2e-9; tested
   against the standard table) + `normCdf`; `demandStatsFromPoints`: weekly σ from the
   forecast's OWN 80% band (hi80−lo80 = 2·z₈₀·σ_w; 95% fallback) so policy inherits exactly
   the uncertainty the model measured; `derivePolicy`: SS = z·√(L·σ_d² + d̄²·σ_L²) (reduces
   to classic z·σ·√L at σ_L=0), ROP = DDLT + SS, ROQ = max(MOQ, coverage-days demand) —
   **true EOQ deferred honestly: the schema has no ordering/holding cost params**
   (docs/INVENTORY_OPTIMIZATION_NOTES.md roadmap), DOS = position/daily, stockout risk =
   P(D_LT > position − SS) — exactly 50% when the position sits ON the reorder point (tested);
   `chooseLeadTime`: configured `product_suppliers.lead_time_days` unless the supplier
   scorecard has sample_size ≥ 5 (then empirical avg + stddev — dormant until Block 10
   populates scorecards, the formula already consumes it); **a SKU with NO lead time anywhere
   is skipped and counted, never given an invented default**; service-level clamp 90–99.5%.

2. **Derivation engine (`src/lib/policy/derive.ts`)** — for every PROMOTED forecast in scope:
   per (product, location) from `inventory_levels` (fallback: the tenant's first location
   with DOS/risk null — no on-hand data is a fact, not a zero); the saved `service_level`
   survives recomputes (operator default); upserts on the policy PK — **the Foundation audit
   triggers log every change** (no manual audit writes needed). Runs as the **policy step at
   the end of each forecast shard** (FEATURES Block 9 step 1, via the shard workflow) and
   after `recomputeForecast`.

3. **SKU-detail widgets** — `PolicyPanel` on `/inventory/[productId]`: DOS hero StatNumber
   with flow/warn/stop vs lead-time coverage + "Forecast holds through {date}" (the last
   forecast point), Stockout-Risk hero with semantic tone, ROP/SS/ROQ row, lead time **with
   its source label** ("supplier setting" / "empirical · scorecard" — the FEATURES Codex
   line), service level. Links to the bench.

### 9b — the what-if bench (the memorable element)

4. **`/inventory/policy`** — the bench: three levers (service-level slider 90–99.5 clamped,
   lead-time override slider with reset, supplier chips with each option's lead time) over
   the **POLICY RIBBON** — DOS · ROP · SS · ROQ · RISK, every number ticking via the new
   `NumberRoll` component (counter-roll on change, `--duration-quick`/`--ease-tick`,
   reduced-motion safe). Below: the coverage ledger, thinnest DOS first, rows re-aiming the
   bench. **Save as default** (owner/manager) commits the service level then reruns the SAME
   derivation engine — the stored row is always the engine's output.

5. **Architecture note (deliberate FEATURES deviation, flagged for review):** the letter says
   sliders recompute "via a Server Action"; the bench instead loads the inputs once and runs
   the SAME pure `derivePolicy` client-side — instant ripple (the 250ms p95 criterion beaten
   by orders of magnitude) and scrubbing **provably cannot write**. The save path recomputes
   server-side as the authoritative write. Same deviation class as vercel.json-over-vercel.ts.

## Verification

- **Tests: suite 451/451** (31 new: compute 19 — z-table, band-σ, SS reduction + lead-σ
  widening, MOQ floor, DOS, risk-at-ROP = 50%, degenerate σ, clamps; derive integration 3 —
  promoted→row with audit-trigger proof, service-level persistence with smaller-SS check,
  skip-no-lead-time; save-action 4 — gate, clamp-then-engine-rerun, no-policy guard,
  surfaced recompute failure; memorable 5). tsc/biome/build clean (`/inventory/policy` in
  the route table).
- **Live (Riverbend Hardware):** batch re-run executed the new shard policy step (after a
  dev-server restart — the DevKit manifest only discovers new steps at boot); DB facts:
  RVB-1107 ROP 57.01 / SS 12.12 / ROQ 280 / DOS 48.5 / risk 0.0000; RVB-2214 ROP 39.30 /
  DOS 23.9 / risk 0.0003. SKU-detail widgets verified (screenshot reviewed): DOS 48.5 flow
  green, "Forecast holds through Jul 25", risk 0.0%, the full numbers row.
- **Bench live:** scrubbed service level 97 → 99.5 in the real browser — SS 10.2 → 13.9,
  ROP 39.3 → 43.0, risk 0.0 → 0.3% (the bar itself rose), DOS/ROQ correctly unmoved; Save
  committed 0.995 and the SERVER recompute matched the client preview to the decimal
  (SS 13.91 / ROP 43.05); audit_log carries 4 inventory_policy rows from the triggers;
  RVB-1107 untouched at 0.97. Console clean.
- **Memorable artifact:** `_reviews/2026-06-12_feature_policy_whatif_memorable.test.tsx` —
  three levers render, scrub ripples the ribbon with the roll armed, supplier swap re-aims
  lead time (9d → 14d empirical), **scrubbing performs ZERO writes** (the action fires only
  on the explicit Save), Save disabled until dirty.

## Honest scope notes

- Policies derive for PROMOTED forecasts only (the FEATURES acceptance bar). Warming/cold
  SKUs get no policy row — no invented numbers from unproven models.
- The scorecard-empirical lead-time path is fully wired but dormant until Block 10 writes
  `supplier_scorecards`; today every SKU reads "supplier setting".
- ROQ is the coverage heuristic, not EOQ (no cost params in schema) — documented in code +
  the optimization-notes roadmap; revisit post-MVP.
- Save commits the service level only; lead-time/supplier levers are exploration (the
  schema's policy parameters don't include overrides — supplier changes are real actions on
  the SKU page). Stated in the bench's own copy.
- Multi-location: per-location rows where levels exist; the engine still keys demand off the
  tenant-wide forecast (per-location forecasting is the later multi-location wave).
- The 250ms ripple criterion is met by construction (client-pure math); no Preview-harness
  number was measured for it.
