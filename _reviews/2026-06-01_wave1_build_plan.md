# The Chain — Wave 1 Build Sequence (Phase 6)
*Created 2026-06-01. Phase 5 Foundation shipped + deployed + 5K-hardened. This locks the ORDER the 17 FEATURES.md blocks get built in.*

## How Phase 6 runs (PROCESS.md)
Per-feature loop, never batched: **build one feature → preview screenshot → MG approve → `moretech-codex-review` → MG says "push" → push → next.** The tranches below are dependency ordering, NOT batched checkpoints. Every feature still gets its own MG + Codex gate, and must show its "What's memorable" element in a Playwright/screenshot before it passes (the visible-craft gate).

## Already partially built in Phase 5H (finish, don't restart)
- **Block 1 Account creation + sign-in** — signup/signin pages, `AuthForm`, `actions.ts`, `bootstrap_tenant` RPC all live. REMAINING: forgot-password + Resend, the memorable "form becomes the workshop" transition, atomicity/audit integration tests, CTA copy polish.
- **Block 17 Marketing** — shell live (top bar, hero, ignited PO-chain aside). REMAINING: how-it-works, pricing, about, contact, PostHog wiring, Lighthouse ≥90.
- **Block 15 Dashboard `/today`** — bench shell + empty state live. REMAINING: today's-chain centerpiece, metric strip, ClaudeInsight rail, throughput ruler.

## Build order (dependency-driven)

### Tranche A — Entry + master data (the canonical anchor)
1. **Block 1 — Account creation + sign-in** (finish the 5H work)
2. **Block 3 — Master data: products + SKUs**
3. **Block 4 — Master data: suppliers + lead times**
*Rationale: everything downstream reads products/suppliers. No deps beyond Foundation/Account.*

### Tranche B — Ingestion (get real data in)
4. **Block 5 — CSV import (`CsvSourceAdapter`)** ← recommend building before QBO
5. **Block 6 — QuickBooks Online (`QboSourceAdapter`)**
6. **Block 2 — Tenant onboarding workflow** (wraps A+B into the new-user flow; needs master data + ≥1 source)
*Rationale: CSV has no external-OAuth dependency, so it unblocks onboarding + forecasting with seed data fastest. QBO is the anchor integration but needs Intuit sandbox setup. Onboarding can't complete until a source exists.*

### Tranche C — Intelligence (the brain)
7. **Block 8 — Demand forecasting pipeline** + **Block 7 — ABC/XYZ classification** (built together — classification runs inside `forecastTenantBatchWorkflow`)
8. **Block 9 — Inventory optimization** (policy + DOS + stockout risk)
*Rationale: Python Fluid forecast function + workflow batch. Classification and forecasting are mutually dependent (method routing), so they ship as one feature. Policy derivation runs at the end of each forecast shard.*

### Tranche D — The action loop (the hero)
9. **Block 11 — Reorder workflow + PO lifecycle** + **Block 10 — Supplier scorecard** (mutual dep: scorecard needs PO receipts; reorder uses empirical lead time from scorecard. Build lifecycle first, hook scorecard rollup into receipt.)
10. **Block 13 — In-app alerts** (recommendations fire from `alertGenerationWorkflow`)
*Rationale: the primary action loop + the product's hero moment (the full-width PO chain with cobalt ignite on receive).*

### Tranche E — Overlay + the daily surface
11. **Block 12 — AI insights layer (Claude)** — over forecasts/policy/reorder
12. **Block 14 — Audit log + retention tiers** — triggers exist; build the view + cold archive
13. **Block 15 — Inventory health dashboard `/today`** (finish — needs all the above to be meaningful)
*Rationale: the dashboard is only meaningful once there's real data + a live PO chain to render.*

### Tranche F — Commercialization
14. **Block 16 — Subscription / trial / billing wiring**
15. **Block 17 — Marketing site** (finish)

## Heavier UIs needing explicit MG sign-off (Phase 4 review flagged these)
These are in the spirit of Wave 1 but heavier than the PRD literally names — they can eat Phase 6 time before the core reorder loop is proven:
- **Block 7** — classification drag-zoom quadrant (A/B/C × X/Y/Z grid).
- **Block 9** — inventory policy real-time what-if sliders (service level / lead time / supplier).
MG should confirm both stay in Wave 1 vs. simplify-now-enhance-later.

## Decisions (locked 2026-06-01 by MG)
1. **Build order A→F: APPROVED.**
2. **First feature: finish Block 1 (Account creation)** before Block 3.
3. **Tranche B: CSV first**, then QBO, then onboarding.
4. **Heavier UIs (Block 7 quadrant + Block 9 policy sliders): KEEP as spec'd** in Wave 1.

## Resolved by FEATURES.md / earlier reviews (no action needed)
- Subscription + Marketing in Wave 1 scope: confirmed by MG 2026-05-30.
- Sales/movement → `stock_movements` ingestion verification: now in CSV + QBO acceptance criteria.
- Single-tenant/single-location/single-user UI suppression: now a dashboard acceptance criterion + Codex check.
