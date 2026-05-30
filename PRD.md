# The Chain — PRD
*Phase 1 artifact. Required by PROCESS.md.*
*Created: 2026-05-28. Updated: 2026-05-29 (post-Codex Beat 4). Updated: 2026-05-30 (build philosophy aligned: wire for full vision, release in waves).*
*Type: MoreTech Product (internal, in-house)*

> The PRD is the operating spec. PROJECT.md is the elevator pitch. This is what a developer could actually build against.
>
> **Operating principle (confirmed 2026-05-30):** architect for the full vision now, release in waves, no refactor-later mode. This PRD is structured around two layers: the architecture wired from day one (Phase 2 SYSTEM_DESIGN.md commits the exact contracts), and the release waves that ship UI on top of a data layer that already supports them.

## Problem statement
Small and mid-sized retailers and distributors decide what to stock and when to reorder using spreadsheets, memory, and gut feel. Two failure modes happen constantly:
1. **Over-ordering:** cash and shelf space tied up in slow-moving or dead stock. The operator does not see it until the money is already stuck.
2. **Under-ordering:** stockouts on the items that actually sell, which means lost sales, backorders, and unhappy customers.

Reordering itself is manual and reactive: someone eyeballs what looks low, guesses a quantity, and places an order, often too late to cover the supplier lead time. Across multi-location operators, the problem multiplies: stale numbers across plants, third-party warehouses, and consignment sites; departments fighting over conflicting data; suppliers' variable lead times turning planning into firefighting. The enterprise tools that fix all of this exist for large operators only. Smaller and mid-sized operators are left with QuickBooks, spreadsheets, and instinct.

## Target users
**First-release beachhead:** B2B distributors and wholesalers, small to mid size. **Eventual market:** scales upward into mid-market multi-location distribution and outward into independent retailers. The product is built so a customer that starts on the first release and grows into multi-location, multi-user, multi-department operations stays with us instead of churning to a heavier tool.

### Primary persona
- **Name (archetype):** Dana, the operations / inventory lead at a small-to-mid B2B distributor or wholesaler (roughly 500 to 5,000 active SKUs, with a long tail of intermittent-demand items).
- **Context:** Already on QuickBooks Online (or comparable accounting/ERP). POs handled there. Manages purchasing, suppliers, and stock out of QBO plus spreadsheets. Not a data scientist. Has strong instincts but no system to turn instinct into reliable reorder decisions across the full SKU catalog.
- **Pain we're removing:** Capital trapped in dead stock, revenue lost to stockouts on the sporadic-but-critical SKUs, and hours each week spent on manual reorder math that is still guesswork.
- **Why they'd choose this over today's alternative:** Enterprise-grade demand forecasting (including for intermittent demand), optimal stock levels, and an end-to-end reorder workflow at a small-business price, explained in plain language, connected live to the systems they already use, with a clear upgrade path as the business grows.

### Secondary personas (later waves)
- **The new operator (greenfield):** starting up, no sales history. Needs sensible defaults and a path that gets smarter as data accumulates.
- **The multi-location distributor:** locations, warehouses, possibly 3PL or consignment sites. Different roles on the team (planner, warehouse, finance, manager, owner) want their own views off one source of truth.
- **The independent retailer (later wave):** POS-driven, smaller SKU count, different rhythm of sales data.

## Product structure
The product is two layers:
1. **Architecture wired from day one.** Phase 2 SYSTEM_DESIGN.md commits the schema, RLS, audit log, adapter contract, and API shape against the full roadmap.
2. **Release waves.** Each wave layers UI on top of a data layer that already supports it.

## What gets wired into the architecture from day one
*Built and tested before any UI ships. Phase 2 SYSTEM_DESIGN.md commits the exact contracts and the acceptance test for each.*

- **Multi-tenant isolation** via Supabase RLS.
- **Multi-location per tenant.** Stock model carries on-hand, allocated, and in-transit per location.
- **Multi-user per tenant with role-based access** (planner, warehouse, finance, manager, owner). RLS roles defined from day one.
- **Departments / cost centers** for cross-team views.
- **Supplier scorecard timeseries.** Every PO captures promised vs actual delivery date and quantity. Reliability is computed, not assumed.
- **ABC + XYZ classification** fields on every SKU. ABC by value, XYZ from the ADI/CV² classifier.
- **Cycle-count workflows + variance logging schema.**
- **Audit log on every state change.** Powers the future ROI Impact Dashboard. Writes start immediately on first release.
- **Multi-aggregation forecasting.** SKU, SKU × location, eventually SKU × channel. Forecast layer is aggregation-aware in the schema.
- **Two-way ERP sync** with idempotent writes, retry, and conflict resolution.
- **Source-adapter contract** covering everything we will ever plug in: QBO native first; Rutter for NetSuite + Acumatica + Sage Intacct + Dynamics 365 BC + Xero + Shopify + Square + Clover; distribution ERPs (Cin7, Fishbowl, Katana, Zoho Inventory, Unleashed) as future paid native projects.

## Release Wave 1 (first release, full implementation)
*The first surface customers see. Sits on the full-vision data layer. SMB distributor on QBO is the target.*

- Account + auth.
- Single-tenant single-location single-user UI on top of the multi-everything schema.
- **Onboarding, dual path:** "Connect QuickBooks Online + optional CSV history" (existing) vs "Start fresh" (greenfield, guided minimum-field setup).
- **Data sources:** live QBO two-way sync (reads products/items/vendors/POs/bills; writes back the POs we generate) plus universal CSV import as fallback. Both behind the same source-adapter interface.
- **Product / SKU catalog** normalized into the canonical model.
- **Sales / movement data** ingestion (QBO sync + CSV).
- **Supplier / vendor records** with lead time, MOQ, cost.
- **Demand prediction:** Nixtla `statsforecast` with Croston/SBA/TSB + AutoETS/AutoARIMA, ADI/CV² auto-routing. Per-SKU forecasts with confidence ranges and plain-language drivers.
- **Inventory optimization:** computed reorder point, safety stock, recommended order quantity per SKU.
- **ABC + XYZ classification visible per SKU.** Nearly free output of the data we already have.
- **Days of Supply + Stockout Risk Score** as named dashboard widgets.
- **Reorder recommendations + approval** with full PO lifecycle: recommend → approve → export / mark-ordered → mark received (partial or full) → on-hand stock updates.
- **Supplier reliability scorecard.** Computed from captured promised-vs-actual timeseries. Visible per supplier from the first qualifying PO.
- **Inventory health dashboard** for the single location.
- **In-app alerts** (stockout risk, reorder-needed, overstock, late incoming PO).
- **AI insights layer (Claude):** explanation and what-ifs, with explicit confidence and sparse-data badging. Numbers are the source of truth. The explanation never overrides the numeric model.
- **Audit log writes** active from Wave 1 (Wave 6 reads from it).

## Wired-for-later releases (UI in subsequent waves, no schema change required)
*Indicative ordering. Final wave plan is locked in Phase 4 (FEATURES.md).*

- **Wave 2 — Multi-location.** Location selector, location-aware dashboards, inter-location transfer recommendations.
- **Wave 3 — Multi-user + role-based dashboards.** Planner / warehouse / finance / manager / owner views; lightweight shared S&OP layer (everyone reads one number).
- **Wave 4 — Browser barcode + QR scanning + guided cycle counts.** Schema for count sessions and variance is already in place. No native app.
- **Wave 5 — Rutter adapter on.** Instant breadth across NetSuite, Acumatica, Sage Intacct, Dynamics 365 BC, Xero, Shopify, Square, Clover. Validate pricing at activation.
- **Wave 6 — ROI Impact Dashboard.** Reads from the audit log written since Wave 1. Tracks stockout reduction, inventory reduction, expediting cost, payback.
- **Wave 7+ — Distribution-ERP natives** (Cin7, Fishbowl, Katana, Zoho Inventory, Unleashed) as paid per-customer projects.

## Tech preferences
*Direction confirmed by Phase 1 research and the 2026-05-30 build-philosophy alignment. Phase 2 commits the contracts.*

| Layer | Direction | Why |
|---|---|---|
| Frontend | Next.js (App Router) + React + Tailwind | MoreTech default. Server Components + Server Actions support the wave-by-wave UI build cleanly. |
| Backend / API | Next.js route handlers + Server Actions on Vercel (Fluid Compute, Node) | One codebase, longer compute handled by Fluid. |
| Durable orchestration | Workflow DevKit (Vercel) for ERP sync, forecast batches, retries, and long-running cross-system writes | Crash-safe, resumable, the right primitive for two-way ERP sync. Phase 2 commits which orchestrations are workflows. |
| Database | Supabase (Postgres + RLS) | Relational fit; multi-tenant isolation via RLS from day one; supplier scorecard timeseries native to Postgres. |
| Auth | Supabase Auth + tenant/role mapping table | Roles wired in from day one even if Wave 1 only exposes owner. |
| Hosting | Vercel | MoreTech default. |
| AI orchestration / explanation | Claude via Vercel AI SDK + AI Gateway | Trust and what-ifs layer. Never the forecaster. |
| Forecasting runtime | **Nixtla `statsforecast`** on a **Python function on Vercel Fluid Compute**, nightly Cron batch + on-demand for what-ifs. Writes to Supabase. | Mature library with intermittent-demand models out of the box. Apache-2.0 (clean for build-to-sell). Very fast, CPU-only. |
| Integrations (Wave 1) | **QuickBooks Online native** behind the source-adapter interface. Two-way (reads everything; writes back POs we generate). | Distributors cluster on QBO. QBO covers ~80% of canonical model (POs, items, vendors). |
| Integrations (Wave 5) | **Rutter** adapter on. NetSuite, Acumatica, Sage Intacct, Dynamics 365 BC, Xero, Shopify, Square, Clover. | Only aggregator whose schema natively covers inventory + POs + vendors. Validate pricing at activation. |
| Distribution ERPs (Cin7, Fishbowl, Katana, Zoho Inventory, Unleashed) | Per-customer paid native projects when a real customer requires one. | Aggregators do not cover them. Avoid speculative integration work. |

## Tech package
*Initial list. Phase 2 commits exact versions.*

- `next`, `react`, `tailwindcss`
- `@supabase/supabase-js` + Supabase project (Postgres, Auth, RLS)
- Vercel AI SDK (`ai`, v6) + Vercel AI Gateway for Claude
- Vercel Python runtime + `statsforecast` (with `pandas`, `numpy`) for the forecasting function
- Workflow DevKit for durable orchestration
- CSV parsing (`papaparse`)
- Charting library (e.g., Recharts) for inventory and demand visualization
- QuickBooks Online SDK / OAuth (e.g., `node-quickbooks`, `intuit-oauth`)
- Notifications: in-app first; email (e.g., Resend) fast-follow
- Hosting + CI on Vercel

## Architecture principles (carried into Phase 2)
- **Wire for the full vision. Release in waves. No refactor-later mode.** No future wave requires schema change or foundational refactor.
- **Canonical inventory/sales data model + source-adapter layer.** CSV, QBO, Rutter, and future natives each implement the adapter. Everything downstream reads only the canonical model.
- **Explicit "wired-for" acceptance test.** Phase 2 SYSTEM_DESIGN.md defines what evidence proves each wired-for capability (multi-location, multi-user roles, supplier scorecard, audit log, cycle count, ROI, Rutter, distribution-ERP natives) can be activated without schema or contract change.
- **AI trust line.** Statistical models are the source of truth. Claude explains and contextualizes. UI labels low-confidence and sparse-data SKUs explicitly. The explanation never overrides the numeric model.

## Out entirely
*Not in any wave. Pushback agreed at Phase 1 closeout.*
- Make-to-order / manufacturing (BOM, work orders, routings). Different product.
- Real-time external visibility UI across 3PL and consignment. Schema holds the locations; UI does not.
- Heavy enterprise S&OP processes. Lightweight "one number everyone reads" only.
- Auto-sending POs to suppliers without human approval. Wave 1 ends at export / mark-ordered. Full auto-send is a later toggle, not a separate wave.
- LLM as the demand forecaster.

## Success criteria

**Business marker (build-to-sell):**
- Roughly $2K to $5K MRR from real paying distributor subscribers.

**Wave 1 acceptance checks (must all be true at first release):**
- A demand forecast is produced for every eligible SKU. Below threshold, the SKU is on the cold-start ladder and labeled as such.
- Every promoted forecast **beats a seasonal-naive baseline on a rolling-origin backtest**, scored with **RMSSE (primary)** and **WAPE (operator-facing)**. MAPE is banned. The seasonal-naive comparison is stored as the auditable record per SKU.
- Reorder point, safety stock, and recommended order quantity are computed for every SKU from defined inputs.
- PO lifecycle works end to end: recommend → approve → export/mark-ordered → mark received (partial/full) → on-hand stock updates.
- ABC + XYZ classification visible per SKU.
- Days of Supply + Stockout Risk Score visible per SKU.
- Supplier reliability scorecard computed from captured promised-vs-actual timeseries.
- Onboarding works for both paths: QBO connect + CSV history (existing) and minimum-field manual setup (greenfield).
- AI insights layer never contradicts the numeric model. Low-confidence and sparse-data states are explicitly surfaced.
- Audit log captures every state change from Day 1 of Wave 1.

**Wired-for verification (demonstrable at Wave 1 ship):**
- Adding multi-location UI, multi-user + role-based UI, cycle count + barcode UI, Rutter adapter, ROI dashboard, and distribution-ERP natives is a UI / adapter activation, not a schema or contract change.
- Phase 2 SYSTEM_DESIGN.md defines the exact evidence test for each.

**To be locked during pilot:**
- A hard forecast-quality threshold above seasonal-naive (e.g., target RMSSE improvement).
- A target first-paid-cohort date.

## Open questions
- Final product name (working name "The Chain").
- Pricing model and tiers (MG researching, will bring recommendations).
- Salvage check on the roughly 1-year-old "Chain Management Firm" tinkering before deeper build (default: fresh).
- Rutter contract specifics and pricing validation at Wave 5 activation.
- Specific distributor design partner (warm contact) to ground Wave 1 and pilot.

---
**Phase 1 closeout:** Locked. Build philosophy aligned on 2026-05-30 (wire for full vision, release in waves). Phase 2 (System Design) commits the architectural contracts.
