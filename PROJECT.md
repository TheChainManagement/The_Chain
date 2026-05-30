# The Chain
*Working name. Supply Chain AI Platform.*
*Phase 0 artifact. Required by PROCESS.md.*
*Created: 2026-05-28. Updated: 2026-05-30 (build philosophy aligned).*
*Type: MoreTech Product (internal, in-house)*

## Naming & Ownership
- **Working product name:** "The Chain."
- **Company / release vehicle:** More Technologies. Built and released under More Technologies, full stop.
- **History note:** MG previously started a separate entity, "The Chain Management Firm," a while back for an earlier version of this idea, with some tinkering roughly a year ago. Confirmed 2026-05-30: **no salvage, fresh build.** The Chain Management Firm itself may re-emerge later as a separate consulting brand (distinct from The Chain product), depending on how other endeavors unfold. The two should not be conflated: The Chain (product) ships under More Technologies; The Chain Management Firm (potential future consulting brand) is a separate concept MG owns the option on.

## Build Philosophy
**Architect for the full vision now. Release in waves. No refactor-later mode.** Confirmed by MG on 2026-05-30.

The architecture (schema, RLS, adapter contract, audit log, multi-tenant + multi-location + multi-user model, full integration adapter coverage) is built from day one against the entire product roadmap, not against the first release. The first release ships a focused SMB-distributor surface. Every subsequent wave layers UI on top of a data layer that already supports it. No future wave requires a schema change or a foundational refactor.

The standard is quality. Time is not treated as a constraint. MG's working hours are observable, not a scope-limiter for product decisions. The wired architecture is itself the build-to-sell acquisition asset.

## Business Evaluation (Build/Keep/Sell)
- **What is it:** Product. Subscription-based SaaS.
- **Why now:** Portfolio / capability play. Proves More Technologies can ship a sophisticated AI SaaS, built where MG holds an unfair advantage (real supply chain and inventory domain knowledge).
- **Exit strategy:** Build to SELL. The wire-for-full-vision architecture is the acquisition asset, not a quick cash grab.
- **Priority context:** One of MG's three active projects as of 2026-05-28, alongside the Funding Project (Path 3) and Kelia's KAG project. Everything else is paused.
- **Resource posture:** Quality-gated, time-unbounded. MG works on it within his available hours and the project takes as long as it takes. No fixed ship date.

## Vision
A subscription web app that uses AI to optimize inventory levels, predict demand, and run an end-to-end reorder workflow for retailers and distributors of every size we can serve, starting with small-to-mid B2B distributors and scaling upward as the schema already accommodates. It exists because MG holds a rare combination: real supply chain and inventory management expertise (domain knowledge most developers lack) plus the modern web toolkit (Claude, Supabase, Vercel) to build a sophisticated platform. The bet is to build where MG has an unfair advantage. This is a build-to-SELL, portfolio-grade product, engineered to a top-end standard so it carries genuine acquisition value.

## Audience
First-release beachhead is **B2B distributors and wholesalers**, small to mid size. Eventual market scales upward into mid-market multi-location distribution and outward into independent retailers. The product is built so a customer who starts on the first release and grows into multi-location, multi-user, multi-department operations does not have to leave us for a heavier tool. The wires are already there.

## Problem
Small and mid-sized retailers and distributors run inventory on gut feel and spreadsheets. They over-order (cash tied up in dead stock) or under-order (stockouts and lost sales), and reordering is manual, reactive, and error-prone. The enterprise tools that solve this (demand forecasting, optimization, auto-replenishment, supplier scorecards, S&OP alignment) exist for large operators and are priced and shaped for them. Smaller operators are left with QuickBooks, spreadsheets, and instinct. Today they either eat the cost of bad inventory decisions or pay for software that is overkill and unaffordable.

## Success Metrics
- Primary marker (build-to-sell): roughly $2K to $5K MRR from real subscribers. Overlaps MG's 9-to-5 exit trigger ($3K to $4K/mo).
- Product bar: every released wave delivered to a top-end standard, not a demo.
- Wired-for verification: at first release, the architecture demonstrably supports every wired-for capability (multi-tenant, multi-location, multi-user, role-based access, supplier scorecard timeseries, audit log, two-way ERP sync, full adapter contract) without any schema change required to add their UIs in later waves.

## Constraints
- **Technical:** Architecture wired for the full product roadmap from day one. Multi-tenant, multi-location, multi-user, role-based RLS, supplier scorecard timeseries, audit log, ABC/XYZ classification, multi-aggregation forecasting, two-way ERP sync with idempotent writes and conflict resolution, and a source-adapter contract that covers QBO native, Rutter, and future distribution-ERP natives. Each subsequent release adds UI on top of this layer with no foundational refactor.
- **Posture:** Quality-gated. Time-unbounded.
- **Team:** Solo (MG) plus Claude as build partner.
- **Budget:** Likely Supabase + Claude API + Vercel hosting + future per-connection cost for Rutter at activation. Comparable to The More App's roughly $350/mo infra envelope at start; scales with usage. Revisit after first paying users.

## Non-goals
- Make-to-order / manufacturing (BOM, work orders, routings). Different product.
- Real-time external visibility UI across 3PL and consignment sites. Schema holds the locations; we do not build the real-time external-visibility UI without a real customer driving it.
- Heavy enterprise S&OP processes. The lightweight shared-dashboard version is the ceiling.
- Auto-sending purchase orders to suppliers without human approval. First release ends at export / mark-ordered. Full auto-send is a later toggle.
- LLM as the demand forecaster. Claude is the explanation and what-if layer only.

## Open Questions
- Final product name (currently the working name "The Chain").
- Pricing model and tiers (MG researching, will bring recommendations).
- Salvage check on the roughly 1-year-old "Chain Management Firm" tinkering before deeper build (default: fresh).
- Rutter contract specifics + pricing validation at Rutter-adapter activation.
- Specific distributor design partner (warm contact) to ground the first release and pilot.

---
**Phase 0 checkpoint:** Approved. Phase 1 (PRD) complete 2026-05-29. Build philosophy aligned 2026-05-30.
