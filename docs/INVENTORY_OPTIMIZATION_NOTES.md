# The Chain — Inventory Optimization: how it works, and where we tighten it later

*Written 2026-06-03 for MG. Purpose: confirm WHERE we are on the optimization
algorithm, show the data-story loops, and park a "tightening" roadmap that does
NOT change the MVP course. We ship the spec'd Wave 1 policy; this is the map for
after.*

---

## TL;DR

- The optimization **engine is fully specced and the data layer is already wired**
  (the `inventory_policy`, `forecasts`, `supplier_scorecards` tables exist from the
  Foundation). The **compute is not built yet** — it's Tranche C (Blocks 7-9), after
  ingestion (CSV/QBO) lands real sales data to run on.
- Your instinct is right and it's already designed in: **everything feeds one
  loop.** Sales history → demand class → forecast method → reorder math → supplier
  reliability → safety buffers → alerts → reorder → receipt → updates sales history
  AND supplier reliability. The system gets smarter every cycle without us touching
  the schema.
- The MVP ships the **standard, defensible textbook policy** (the right call to get
  out the door). The "9-out-of-10 when X happens, Y happens" tightening you're
  describing is real, valuable, and **possible later with the data we're already
  capturing** — no rebuild. That's the whole point of "wire for full vision."

---

## Where we are right now (verified)

| Piece | Status |
|---|---|
| `inventory_policy` table (service level, demand-during-lead-time, safety stock, reorder point, recommended qty, days of supply, stockout risk) | **Wired (Foundation)** — columns exist, empty until compute runs |
| `supplier_scorecards` (OTIF, lead_time_avg + **lead_time_stddev** + sample_size) | **Wired (Foundation)** — the lead-time-variability input is already in the schema |
| `forecasts` / `forecast_evaluations` (method, confidence, cold-start state, beats-baseline) | **Wired (Foundation)** |
| Sales/movement capture (`stock_movements`, type=sale, signed qty, occurred_at) | **Wired + ingesting** — CSV product import shipped; movements import is Wave 5.2 |
| ABC/XYZ classification compute (Block 7) | Spec'd, **not built** (Tranche C) |
| Demand forecasting pipeline (Block 8) | Spec'd, **not built** (Tranche C) |
| Inventory optimization compute (Block 9) | Spec'd, **not built** (Tranche C) |
| Supplier scorecard compute (Block 10) | Spec'd, **not built** (Tranche D) |

So: the **shape** of every number you asked about is committed; the **calculators**
get built in the intelligence tranche once there's real data to feed them.

---

## The algorithm, in plain language (as specced for Wave 1)

It runs as one nightly batch (`forecastTenantBatchWorkflow`), sharded 200 SKUs at a
time, in this order per SKU:

### 1. Classify the SKU — "what kind of demand is this?"
- **ABC** by trailing-365-day value (revenue or cost basis): where the money is.
- **XYZ** by demand *variability* using the **ADI / CV²** classifier computed from
  `stock_movements`:
  - ADI = average interval between sales (is it lumpy/intermittent or steady?).
  - CV² = variance of sale sizes (is each sale a similar size or wild?).
- This is the first "story" read: a slow, lumpy C/Z part and a fast, steady A/X
  part are **different animals** and must be treated differently. Which leads to...

### 2. Forecast demand — route the method by the demand class
- Library: **Nixtla `statsforecast`** (Python, fast, CPU-only). LLM is NEVER the
  forecaster — it only explains.
- **Method routing by ADI/CV²:**
  - Intermittent / lumpy (X-class): **Croston / SBA / TSB** — models built for
    "sells 0, 0, 0, 7, 0, 0, 3" patterns where normal forecasting fails.
  - Smooth / erratic (Y/Z): **AutoETS / AutoARIMA**.
- **Cold-start ladder** (honest about sparse data):
  - `cold` (< 30 days of sales): uses a **category benchmark** (trimmed mean of
    similar warm SKUs), labeled "warming up." Never shows a fake model number.
  - `warming` (30-89 days): forecast shown, confidence flagged limited.
  - `warm` (90+ days): full forecast, **promoted only if it beats a seasonal-naive
    baseline** on a rolling backtest (scored RMSSE primary, WAPE operator-facing;
    MAPE is banned). The baseline comparison is stored per SKU as the audit record.
- That last point matters: we don't trust a forecast just because we made one. It
  has to **earn promotion** by beating the dumb baseline. That gate is the quality
  floor the whole policy stands on.

### 3. Derive the policy — turn the forecast into reorder math
For each SKU × location, written to `inventory_policy`:

- **Demand during lead time** = forecast demand over the supplier's lead-time window.
- **Safety stock** = `z × σ × √L`:
  - `z` = the service-level factor (default service level **97%**; what-if slider
    90% → 99.5%). Higher service = bigger buffer = less stockout, more cash tied up.
  - `σ` = demand variability. **Crucially, lead-time variability feeds this too** —
    when the supplier scorecard has ≥ 5 receipts, we use the **empirical**
    `lead_time_stddev_days`, not the number the supplier promised.
  - `L` = lead time — empirical from the scorecard when we have ≥ 5 data points,
    otherwise the configured `product_suppliers.lead_time_days`.
- **Reorder point** = demand-during-lead-time + safety stock. "Order when on-hand
  crosses this line."
- **Recommended order quantity** = EOQ with practical adjustments (MOQ, pack size).
- **Days of Supply** = on-hand ÷ mean daily demand.
- **Stockout Risk Score** = probability the next reorder cycle ends below safety
  stock.

### 4. Fire the signals — the loop closes
- The nightly **alert** pass reads the policy and fires actionable memos
  ("SKU 47331 hits stockout in 8.3 days; Calhoun lead time is 7; reorder 47 cases
  by Wed").
- A **reorder recommendation** is written for any SKU at/below its reorder point.
- Operator approves → **PO** → received → **two things update**: on-hand stock
  (`stock_movements`/`inventory_levels`) AND the **supplier scorecard** (promised vs
  actual). That scorecard update flows back into step 3's safety stock next cycle.

**That feedback arrow is the system "learning."** When a supplier quietly slips
from 7 to 11 days, the scorecard catches it, the empirical σ and lead time rise,
safety stock and reorder point auto-adjust, and the next stockout is prevented
before it happens. Nobody re-typed a number. That's the "9-out-of-10" intuition,
mechanized.

---

## Where the real optimization lives — the tightening roadmap (POST-MVP, not now)

The MVP policy above is correct and shippable. But you're right that there's a
deeper layer of optimization, and the beautiful part is **we're already capturing
every input it needs.** Parking these so they're not lost — none of them are MVP,
none change course:

1. **Service level by ABC class, not a flat 97%.** A-items (your money) get a higher
   target; C-items get lower. One line of policy logic, big cash-efficiency win.
   Input needed: ABC class — already computed.

2. **Distribution-aware safety stock for intermittent demand.** `z × σ × √L` assumes
   demand is roughly normal. For lumpy Croston/TSB SKUs it isn't, so the normal
   formula over- or under-buffers. The fix is to size safety stock from the
   **forecast's own error distribution / quantiles** instead of z×σ. Input needed:
   the forecast error bands — already stored in `forecast_evaluations`.

3. **Full lead-time-demand convolution.** The textbook upgrade to safety stock:
   `SS = z × √(L×σ_d² + d²×σ_L²)` — explicitly combines demand variability AND
   lead-time variability. Input needed: `lead_time_stddev_days` — already on the
   scorecard.

4. **Supplier-risk-adjusted timing.** Don't just buffer for an unreliable supplier —
   reorder *earlier* from them, or flag a switch to a better-OTIF alternate. Input
   needed: OTIF + on-time % per supplier — already on the scorecard.

5. **EOQ calibration.** Real holding-cost and order-cost parameters per tenant
   instead of defaults, so recommended quantities reflect *their* economics.

6. **The ROI feedback loop (Wave 6).** The audit log (writing since Day 1) lets us
   measure *actual* stockout reduction and freed cash, then **tune the policy against
   observed outcomes** — the system grades its own recommendations and adjusts. This
   is the long-game optimization engine, and the data collection for it is already on.

**Why this is the right sequence:** ship the standard policy, get it in front of a
real distributor, let it accumulate the supplier timeseries + forecast track record +
audit trail. THEN tighten with calibrated, data-backed levers. Optimizing before
there's real data to optimize against would be guessing. The architecture is
deliberately built so every item above is a **compute change, not a schema change.**

---

## Direct answers to your questions

- **"Analyzing historical sales data"** — yes, `stock_movements` (type=sale, with
  `occurred_at` preserved from source) is the forecast input. Product CSV import is
  live; the sales/movement import is Wave 5.2 (next).
- **"Determining lead times"** — two sources, and it prefers the truth: configured
  lead time at first, then **empirical** lead time from actual receipts once a
  supplier has ≥ 5 POs. Stored on the scorecard with its stddev.
- **"Calculating safety stock levels"** — `z × σ × √L`, service level default 97%,
  with empirical lead-time variability fed in. Tunable live via the what-if sliders.
- **"It all tells a story"** — exactly, and the design encodes that story as the
  forecast→policy→alert→reorder→receipt→scorecard loop. The roadmap above is how we
  make the story *sharper* over time without re-architecting.

---

## Bottom line for the build

- **MVP course unchanged.** Blocks 7-9 ship the policy as specced. No new features.
- **This doc is the optimization backlog**, to revisit once a real tenant is feeding
  the engine. Nothing here is a Wave 1 commitment.
- The reason we *can* defer it safely: the data layer was wired for the full vision,
  so every tightening lever is reachable later as pure compute.
