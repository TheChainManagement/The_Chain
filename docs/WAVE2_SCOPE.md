# The Chain: Wave 2 Scope

Authored 2026-06-27 after MG's hands-on eval. Decisions locked this session:
- **Product direction: industry-fitted modes** (distribution / storeroom / food), ONE primary
  mode per tenant, set by us from who the customer is — NOT a user-facing toggle. Refined
  2026-06-28; see §5. (Supersedes the original "both modes, configurable per tenant" wording.)
- **First build: data-model cleanup**, after a short written mode-spine design pass (§5 made the
  spine load-bearing).
- Raw eval + scenario walkthroughs: see `OPERATOR_EVAL_2026-06-27_WAVE2_PLAN.md`.

This doc reconciles the original repo roadmap (which assumed the distribution path) with
the new "both modes" direction, and defines what Wave 2 actually consists of.

---

## 1. What we have (the foundation Wave 2 builds on)

All of Wave 1 shipped and is live. Grouped by layer:

- **Ingestion:** CSV import (products, suppliers, movements; durable path for large files),
  QuickBooks two-way sync (OAuth, items/vendors/POs/bills/sales, incremental cron + webhook,
  conflict resolution). A pluggable `SourceAdapter` seam underneath both.
- **Master data:** products (SKU, unit of measure, status), suppliers (contact, terms),
  product-to-supplier links (cost, lead time, MOQ), locations, inventory levels
  (on_hand / allocated / in_transit, already stored PER LOCATION).
- **Intelligence engine:** ABC/XYZ classification; statistical demand forecasting
  (Croston / TSB / AutoETS / AutoARIMA + baseline, backtested, with confidence bands, running
  as a Python function on Vercel); inventory policy (safety stock, reorder point, order qty,
  days-of-supply, stockout risk, a what-if bench); supplier reliability scorecards (OTIF,
  empirical lead time).
- **Action loop:** reorder queue (breach detection + grouping), convert to PO, approve (push
  to QBO or mark exported), receive (updates stock), durable PO lifecycle.
- **Overlay:** in-app alerts engine; Claude AI insights (why-this-reorder, why-this-forecast,
  weekly digest, what-if narration).
- **Surfaces:** the /today dashboard, audit-log viewer with retention tiers, onboarding (three
  paths), marketing site, Stripe billing (hard paywall + comp accounts).

**Wired-for but not yet exposed** (schema/seams exist, so these are "light it up," not "build
from scratch"):
- Multi-location (levels are already per-location).
- RLS roles: planner / warehouse / finance / manager / owner are defined; Wave 1 exposes only owner.
- Cycle-count + variance schema is in place.
- The adapter seam accepts new integrations without a rebuild.
- The audit log has been writing since day one (feeds a future ROI dashboard).

---

## 2. What was already planned (original roadmap, distribution-path)

From `docs/USER_FLOW.md`. This is the pre-existing intent, written before the storeroom direction:

| Wave | Original scope |
|------|----------------|
| Wave 2 | **Multi-location** (location selector, per-location dashboards, transfer recommendations). No schema change. |
| Wave 3 | **Multi-user + roles** (planner/warehouse/finance/manager/owner views) + a lightweight S&OP "one number everyone reads." |
| Wave 4 | **Barcode + guided cycle counts** (browser scanning, no native app). |
| Wave 5 | **Rutter adapter** (NetSuite, Acumatica, Sage Intacct, Dynamics 365 BC, Xero, Shopify, Square, Clover). Adapter activation, not a rebuild. |
| Wave 6 | **ROI Impact Dashboard** (reads the audit log: stockout reduction, inventory reduction, payback). |
| Wave 7+ | **Distribution-ERP native adapters** (Cin7, Fishbowl, Katana, Zoho, Unleashed), per paying customer. |

---

## 3. How the decisions reshape Wave 2

The original "Wave 2 = multi-location" was a single-feature step on the distribution path. The
new direction (both modes, storeroom emphasis) makes Wave 2 a themed milestone:

> **Wave 2 theme: turn The Chain from a reorder engine into a real operations system that runs
> a storeroom OR a distribution business, configurable per tenant.**

Pieces of the original roadmap fold INTO this (they were prerequisites all along):
- Multi-location (original Wave 2) matters for storeroom + transfers.
- A slice of roles (original Wave 3) is needed for "who can issue / who can approve."
- Cycle counts (original Wave 4) are core storeroom hygiene and the schema is already there.

What is genuinely NEW (not in the old roadmap): the configurable mode, storeroom issue-out,
the RFQ-to-requisition procurement chain, and the data-model cleanup from the eval.

---

## 4. Wave 2 contents (sequenced)

Each is its own build with the normal gate (build, screenshot, MG review, code review, push).

- **W2-0: Operating mode (the spine) — reframed 2026-06-28.** A per-tenant mode, set by US from
  who the customer is (NOT a user-facing toggle): `distribution` / `storeroom` / `food`
  (food = architect-for now, full build later). The mode defines a DISTINCT material-flow model
  — what counts as demand and how stock moves in/out — not just nav + terminology, over the
  shared forecast/policy/reorder engine. Because Q1+Q2 made this the load-bearing decision, it
  gets a short written design pass BEFORE W2-1 builds. The spine everything else hangs on.
- **W2-1: Data-model cleanup (FIRST, per MG).** Unit-of-measure dropdown (label + abbreviation,
  with an "other" escape hatch); supplier address + contact-person; lead time presented as an
  item property (the per-item value already exists, stop showing it on the vendor);
  user-authored policy (MOQ, reorder qty, min/max) with AI suggesting adjustments instead of
  owning the numbers. Plus the product-to-supplier link import lane (cost/lead/MOQ) so a full
  catalog loads from spreadsheets.
- **W2-2: Storeroom operations.** Issue material out (tagged to a work order / crew / cost
  center), manual stock adjustments, and cycle counts. **Correction (2026-06-28):** `adjustment`
  and `cycle_count` movement types exist, but **issue-out does NOT** — the enum is `sale, receipt,
  transfer_in, transfer_out, adjustment, cycle_count`. W2-2 ADDS `issue_out` / `issue_return` plus
  the demand-reference envelope and `location_kind`, per `WAVE2_W2-0_MODE_SPINE_DESIGN.md` §10.
  Pulls in a minimal role slice (who can issue/adjust) from the original Wave 3.
  **SHIPPED to prod 2026-07-09 (`d29b227..9d50726`).**
- **W2-2.5: Inventory-core hardening (added by the 2026-07-06 audit; SHIPPED to prod
  2026-07-12, `9d50726..7df9ee8`).** UoM conversion (purchase UoM + factor on the supplier
  link), moving-average cost + valuation views/strip/CSV export, on-hold stock status with
  hold/release UI, and the formalized POSTING KERNEL (`post_stock_movement()`; member
  direct writes to balances revoked). Contract: `FEATURES.md` Wave 2 section. Landed
  BEFORE W2-3 per the audit sequencing (vendor quotes arrive in purchase UoM).
- **W2-3: Procurement workflow (BUILT, review-clean, at MG merge gate 2026-07-13).** RFQ
  to one or many vendors, export-for-manual-send documents, purchase-UoM quote comparison,
  per-line awards, single-step requisition approval, and idempotent mixed-vendor PO fan-out.
  The review pass hardened tenant-scoped lineage, atomic award math including MOQ, the
  database no-self-approval boundary, and immutable PO-line UoM snapshots. Full contract:
  `FEATURES.md`; review evidence: `_reviews/2026-07-13_item3_w2_3_review_finish_evidence.md`.
  Production migrations and merge remain MG's gate.
- **W2-4: Multi-location.** The original Wave 2: location selector, location-aware dashboards,
  transfer recommendations (the transfer_in / transfer_out movement types already exist).
  Especially relevant to storeroom.

**Deferred to later waves** (unchanged): full role + S&OP layer (Wave 3), barcode hardware
scanning (Wave 4), Rutter / ERP-native adapters (Waves 5/7), ROI Impact Dashboard (Wave 6).

**Deferred but TRACKED (MG: "do not lose it"):** the ledger **header/line split**
(`stock_movement_events` + `stock_movement_lines`) lands with the **Manufacturing / Produce wave**
(or a lot-traceability deep build, whichever is first), because that is the first flow needing an
atomic multi-line or lot/serial event. Held as a 🔴 ticket in `_reviews/_tickets.md`; rationale +
migration path in `WAVE2_W2-0_MODE_SPINE_DESIGN.md` §10. The W2-0 columns are shaped now so the
split is additive later, not a rewrite.

**Carry-over gap (not a feature, but live-customer-critical):** ~~password reset / auth recovery
still does not exist. Slot it in early.~~ **SHIPPED 2026-07-07** — full recovery flow live on
production (merged to main `f1c18b6`, Vercel deployed, Supabase redirect allowlist + token_hash
email template configured by MG). Evidence:
`_reviews/2026-07-07_item0_password_reset_evidence.md`; Codex review + decisions:
`_reviews/2026-07-07_item0_password_reset.md`.

---

## 5. Resolved decisions (settled 2026-06-28 with MG)

1. **Mode granularity → industry-fitted, NOT user-selected.** There is one primary mode per
   tenant, but the user never picks it from a menu. We determine it from what the customer IS
   (their onboarding conversation / what they came looking for) and fit the product to their
   industry. A distribution company that comes for inventory software gets the distribution fit;
   a storeroom gets work-orders + issue-out; a restaurant gets expiration/lot handling. So
   `both` is NOT a blend the user toggles — each tenant runs in ITS mode, built for it.
   - **This wave: build the SEPARATION** — stand up the distinct modes and fit each to its industry.
   - **Three modes, not two:** distribution (sales-primary), storeroom (work-orders / issue
     material), food/restaurant (expiration dates, lot/batch — "a whole different beast";
     architect-for now, full build later).
   - **Assignment mechanism (this wave): MG sets the mode manually**, from a live customer
     conversation — they call about inventory software, MG points them to / sets up the right
     mode. Admin-set, not self-serve, not AI.
   - **Anticipated (design TBD, NOT this wave):** a guided **industry-selection step in setup** —
     "what industry are you in? sales-driven / maintenance-driven / food service / ..." — where the
     user picks from listed options that map to a mode, then builds out what they need. This is
     how "not a freeform mode toggle" reconciles: it's an INDUSTRY question that resolves to a
     mode, NOT the user choosing "storeroom vs distribution" directly. Not AI (MG sees no good AI
     fit for this yet). **Open: how different user types should set up their own mode needs its
     own conversation — MG explicitly wants to talk this through before designing it.**
2. **Material flow is DISTINCT per mode — do NOT build/configure them the same.** The
   forecast/policy/reorder math is shared infrastructure, but how material FLOWS — what generates
   demand, how stock moves in and out — is modeled separately in each mode. Sales drive
   distribution demand; work-order issues drive storeroom consumption; food adds
   expiration-driven flow. Inventory flows differently by industry and the model must reflect
   that. UI need not differ per mode; the underlying flow does.
3. **RFQ → single OR multi-vendor, user's choice per RFQ.** Build both from the start. A user can
   send a quote request to one preferred vendor, or to several and compare what comes back (the
   common "get three quotes" pattern). Not multi-only, not single-first — both, selectable.
4. **Work-order tagging → free-text reference for now.** Issue-out tags a free-text work-order
   ref. A real work-order / maintenance object is its own module, wired in later when the
   maintenance layer is built. Inventory is the focus now.

---

## 6. Long-term frame (why we get this right the first time)

No rush to release — this is a deliberate build, run as a side project until the rest is in
place, done the right way. The long game: sell a standalone inventory-management system NOW to
individuals who need it, while building toward the full supply-chain firm. **Inventory is the
CORE module.** The eventual product spans the whole chain — purchasing, maintenance, inventory,
logistics — as connected modules, and MG's own inventory system is the center of it. Every Wave
2 decision (the mode spine; the free-text work-order ref that later becomes a real maintenance
object) is made to fit that bigger architecture, not just today's inventory tool.
