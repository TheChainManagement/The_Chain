# Block 15 — Inventory health dashboard (`/today`)

**Date:** 2026-06-16
**Status:** BUILT + Codex-gated (round 1) + live-verified. Pending: push.

## What shipped

The daily landing surface, now that the full intelligence engine (ingest →
classify → forecast → policy → reorder → PO lifecycle → scorecards → alerts → AI
insights) is complete. `/today` turns all of it into one operator screen.

- **Centerpiece — today's chain.** The most-pressing in-flight PO rendered as the
  full visible chain (SUPPLIER → ORDERED → IN TRANSIT → RECEIVED). The active link
  carries the **memorable interaction**: a 2s cobalt **heartbeat** pulses while the
  day's top recommendation is unacknowledged; the operator clicks *Acknowledge
  today's recommendation* and the heartbeat stops, replaced by a steady flow-green
  settled dot. When nothing is in flight: "No active chain — your workshop is at
  rest" (dotted-lattice empty panel).
- **Metric strip (each clickable).** AT STOCKOUT RISK · WORST DAYS OF SUPPLY ·
  OTIF for the most-used supplier · OPEN ORDERS. All via `<StatNumber>`/`MetricCell`,
  no card boxes, semantic tones (stop/warn/flow), organic decimals (DOS `4.0`,
  OTIF `86.0%`).
- **Right column.** Claude "today's top recommendation" (`ReorderInsightPanel` for
  the in-flight PO; `WeeklyChangeInsightPanel` fallback) + recent alerts triage
  (worst-first, capped, links to `/flow/alerts`).
- **Throughput ruler.** Hairline with 7 UTC day ticks, today marker, last-7-days PO
  completions as typeset chips along the rule.
- **Three population states** (all required by acceptance):
  - `fresh` — no catalog yet → connect-a-source CTA **+ import-a-spreadsheet** path.
  - `onboarding` — catalog imported, engine hasn't produced an actionable surface
    yet → "your workshop is forming" + shape-preview metric strip.
  - `populated` — orders/recommendations to act on → the full dashboard.

## Memorable element — heartbeat → acknowledge → settle

The dashboard's active state is literally a heartbeat on the chain. Acknowledging
reuses the audited, RLS-fenced `acknowledgeAlert` (the alert update is logged by
the trigger), so it is honest wiring, not a bolt-on. `acknowledgeTopRecommendation`
additionally revalidates `/today`.

Artifact (driveable interaction test, runs in CI):
`_reviews/2026-06-16_feature_today_dashboard_memorable.test.tsx` — drives the real
`TodayChain` through pulse-on → click → pulse-off + settled, asserts the action was
called, and the resting (no-pressing) state. Live browser run also verified (below).

## Architecture / reuse

- Pure selection + bucketing logic in `src/lib/dashboard/transform.ts`
  (`pickMostPressingOpenPo`, `stockoutCount`, `worstDaysOfSupply`,
  `mostUsedSupplier`, `throughputLast7Days`, `dashboardStage`) — unit tested in
  `tests/dashboard/transform.test.ts`.
- Dashboard-specific reads in `src/lib/dashboard/queries.ts` (`loadSupplierOtif`
  rolling-30d scorecard map, `countActiveProducts`). Other reads compose the
  existing RLS read models (`listPurchaseOrders`, `loadReorderQueue`,
  `listOpenAlerts`) + `buildOrderChain`/`orderConnector`.
- `ChainLink` extended with `pulse` + `settled` (heartbeat overlay is opacity-only,
  composes over the existing ignite; reduced-motion shows a steady tint).
  `--duration-pulse: 2000ms` token added.
- `/today` builds as `◐` Partial Prerender (static shell + streamed dynamic content
  behind `today/loading.tsx`).

## Verification

- **Tests:** 592/592 (+19: dashboard transforms, memorable interaction, Wave-1
  suppression). `tsc` clean, `biome` clean, `next build` clean (`/today` = PPR).
- **Live (dev :3100, tenant `reorder-verify@thechain.test`):**
  - Empty state: "Your bench is empty" + connect + import CTAs.
  - Populated (seeded local scenario): metric strip with real tones, in-flight
    chain (IN TRANSIT active, `data-pulse="true"`), throughput ruler ("4 POs
    completed in the last 7 days"), **live Claude insight** generated real grounded
    prose (90% confidence, `anthropic/claude-sonnet-4.6 · prompt v1 · cached`), 3
    alerts.
  - Heartbeat → acknowledge: clicked the button → `data-pulse` true→false,
    `data-settled` false→true, "Acknowledged — the bench is steady." 0 console errors.
  - Screenshot captured inline (the preview screenshot tool does not persist to
    disk in this env — a11y snapshot + DOM assertions are the evidence of record per
    the standing gotcha).
- Local throwaway seed used a one-off script (removed, not committed); seeded rows
  live in the local DB only (wiped on next `db reset`).

## Acceptance criteria

- [x] Renders meaningfully at every stage — `fresh` / `onboarding` / `populated`
  (the three states the spec names), via `dashboardStage`.
- [x] Chain visualizer is the visual centerpiece.
- [x] All numbers via `<StatNumber>`; no card boxes.
- [x] Wave-1 suppression: no location selector / role switcher / tenant selector —
  asserted by `tests/dashboard/suppression.test.tsx`.
- [x] Memorable element implemented + captured as a driveable interaction test.
- [ ] `npm run bench:dashboard` p50<800ms/p95<1.5s @ 5k SKUs — DEFERRED to the
  seeded Vercel Preview harness (shared standing bench ticket; the script isn't
  written yet; Local World timing isn't the SLO).

## Codex round-1 disposition (`_reviews/2026-06-16_block15_today_dashboard.md`)

**Fixed in-slice:**
- **Most-used supplier contract** — now the supplier on the most POs (by volume)
  with OTIF from the rolling-30d scorecard map (`mostUsedSupplier` + `loadSupplierOtif`),
  matching FEATURES "supplier OTIF for the most-used supplier." (Removes the earlier
  "priority supplier = most SKUs" deviation.)
- **Onboarding-in-progress state** — real third state via `dashboardStage` +
  `countActiveProducts`; "your workshop is forming" surface. (The "renders at every
  stage" claim is now true, not box-checked.)
- **Fresh CTA drops no ingest path** — offers "Connect a source" (`/integrations`,
  covers QBO + future) **and** "import a spreadsheet" (`/import`). (Block 2 onboarding
  route isn't built yet, so connect/import is the genuine next step.)
- **Organic decimals** — DOS and OTIF show one decimal instead of `Math.round`.
- **Artifact naming** — evidence renamed to `_reviews/<date>_feature_<name>.md`.

**Pushed back, with precedent (ticketed in `_tickets.md`):**
- **Right-rail layout slot** — page-local right column; the standing `<RightRail>`
  needs a parallel-route/slot hand-off (same open item as Block 12).
- **Playwright artifact** — infra-blocked across all blocks; the driveable RTL test
  + live browser verification is the accepted standing substitution.
- **Raw-px → tokens** — house style; the post-Path-3 stack-audit pass owns it.
- **Per-section Suspense streaming + `'use cache'` tags** — cross-cutting: the entire
  app uses dynamic RLS reads + PPR + `revalidatePath` (no block uses `'use cache'`).
  This is an architecture pass, not a Block-15 skip. `/today` already streams behind
  the segment boundary.
- **"Too mocked"** — answered by the live browser verification above (populated +
  empty + acknowledge + real AI insight, 0 console errors).

## Follow-ups → `_tickets.md`

- `bench:dashboard` 5k SLO on a seeded Preview (script not yet written).
- Move today's insight + alerts into the layout `RightRail` slot.
- Per-section Suspense streaming + precise `'use cache'`/`cacheTag` (cross-cutting).
- Playwright pulse-on/off capture (infra-blocked).
