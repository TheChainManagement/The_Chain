# Codex Review — block6_wave6_2b_qbo_durable_sync
**Date:** 2026-06-06 19:59
**Project:** The Chain
**Project type:** MoreTech Product
**Phase:** 6 (Features)
**Unit reviewed:** block6_wave6_2b_qbo_durable_sync
**Review weight:** full
**Skills audited:** feature-dev
**Reviewer:** Codex CLI (model: gpt-5.4)

---

## What was done

- The durable initial-sync path is real. `runQboInitialSync()` pre-creates a `sync_runs` row, starts `qboInitialSyncWorkflow`, and returns a tracking key for polling (`src/app/(app)/integrations/actions.ts:130-186`). The workflow boundary is also clean: orchestration in `"use workflow"`, I/O in `"use step"` (`src/workflows/qbo-sync.ts:22-37`).
- There is real write-core code for products, suppliers, and stock movements. `syncCatalogFromAdapter()` drains QBO payloads and writes `products`, `suppliers`, and `stock_movements`, then finalizes the run and stamps `last_synced_at` (`src/lib/qbo/sync-core.ts:127-167`, `src/lib/qbo/sync-core.ts:172-323`, `src/lib/qbo/sync-core.ts:463-492`).
- The connected UI now drives the durable path instead of the old read-only live preview. `ConnectPanel` starts the sync, polls progress, shows counts, and exposes post-import links to inventory and suppliers (`src/app/(app)/integrations/quickbooks/ConnectPanel.tsx:170-245`, `src/app/(app)/integrations/quickbooks/ConnectPanel.tsx:298-345`).
- There is real integration-style test coverage for the write core against Supabase: first run, movement resolution, and idempotent re-run (`tests/qbo/sync-core.test.ts:103-154`).

## What wasn't done

- The feature block is still not delivered end-to-end. `FEATURES.md` requires `qboIncrementalSyncWorkflow`, a 15-minute `vercel.ts` cron, Intuit webhook handling via `createWebhook()`, conflict resolution, `/app/flow/sync-conflicts`, and `resolveSyncConflict(...)` (`FEATURES.md:271-272`, `FEATURES.md:278`, `FEATURES.md:288-289`). Those artifacts are not on disk; the current tranche note still tickets them forward (`_reviews/2026-06-06_block6-wave6_2b-qbo-durable-sync.md:66-69`).
- Purchase-order sync is still incomplete relative to the block. The feature sequence says the initial workflow is a full pull of items, vendors, POs, bills, and sales (`FEATURES.md:270`). The shipped code explicitly does not write POs into `purchase_orders`; it only drains them for counts (`src/lib/qbo/sync-core.ts:17-19`, `src/lib/qbo/sync-core.ts:160-167`), and the evidence file admits PO write-back/model work is deferred (`_reviews/2026-06-06_block6-wave6_2b-qbo-durable-sync.md:66-67`).
- Several acceptance criteria are still undelivered. The 60-second OAuth-to-first-sync SLO, 15-minute incremental sync, and generated-PO round-trip are required (`FEATURES.md:276-280`) and still explicitly ticketed as follow-up (`_reviews/2026-06-06_block6-wave6_2b-qbo-durable-sync.md:66-69`).
- The required memorable artifact is still not the required artifact. The contract demands a preview screenshot or Playwright interaction test (`FEATURES.md:290-292`). What exists is a jsdom Vitest file that mocks the integration actions and says outright that “A true Playwright 3-state capture is ticketed” (`_reviews/2026-06-05_feature_qbo_connect_memorable.test.tsx:20-22`, `:29-35`).
- Skill compliance is unauditable. `feature-dev` is claimed, but there is no registry entry for it, so there is no declared-artifact contract to verify against.

## What can be done better

- The UI copy is overclaiming the shipped capability. The panel lede says The Chain “writes generated POs back” (`src/app/(app)/integrations/quickbooks/ConnectPanel.tsx:273-276`), but this tranche explicitly defers PO write-back (`_reviews/2026-06-06_block6-wave6_2b-qbo-durable-sync.md:66-67`). Don’t advertise a two-way sync you have not wired into production.
- The live poller has a bad failure mode. `getQboSyncProgress()` can return `{ status: 'unknown' }` (`src/app/(app)/integrations/actions.ts:202`), but `pollLiveSync()` has no branch for that and will just sleep/retry until the 10-minute cap before showing a generic error (`src/app/(app)/integrations/quickbooks/ConnectPanel.tsx:172-199`). Missing run, bad tracking key, or RLS mismatch should fail fast.
- Token discipline is still being violated in this surface. The stylesheet literally documents that it still uses raw px values (`src/app/(app)/integrations/integrations.module.css:5-6`), and the file contains them throughout (`:12`, `:37-42`, `:123-139`, `:239`). That is a direct violation of the project’s “no hardcoded design values” rule, not a cosmetic nit.
- The verification story is too narrow at the action layer. There is real coverage for `sync-core`, but nothing on disk exercises `runQboInitialSync()` or `getQboSyncProgress()` the way the user actually hits them. The current memorable test mocks both actions entirely (`_reviews/2026-06-05_feature_qbo_connect_memorable.test.tsx:29-35`), so the highest-risk surface is still unproven.

## What was missed

- The memorable element drifted off-spec. The feature contract says the chain should form as **supplier → ordered → in-transit** (`FEATURES.md:292`). The shipped UI changed the chain to **CATALOG → SUPPLIERS → SALES** (`src/app/(app)/integrations/quickbooks/ConnectPanel.tsx:42-43`, `:81-89`), and the evidence file celebrates that new sequence (`_reviews/2026-06-06_block6-wave6_2b-qbo-durable-sync.md:27-30`). That is not refinement. That is a different feature than the contract.
- The review artifact missed its own scope drift. The tranche note says the chain now links into `/inventory` and `/suppliers` as the “craft delta” (`_reviews/2026-06-06_block6-wave6_2b-qbo-durable-sync.md:27-31`), but the block’s memorable requirement was specifically about watching existing QBO PO state become a visible chain (`FEATURES.md:292`). The visible-craft gate got satisfied with a substitute, not the contracted behavior.
- The block’s two-way-sync requirement is still being treated like optional future work. The adapter has a PO push implementation (`src/lib/qbo/adapter.ts:179-208`) and unit tests for it (`tests/qbo/adapter.test.ts:133-173`), but production code still does not call it. That gap was already known, and this tranche still didn’t close it.

## Decisions (captured 2026-06-06, MG)

### UI copy overclaims PO write-back ("writes generated POs back")
- **Decision:** Fix now.
- **Action:** Reworded the panel lede to "reads … into your catalog. (Writing generated POs back is on the way.)"

### Poller has no `unknown` branch — spins to the 10-min cap on a missing/bad run
- **Decision:** Fix now.
- **Action:** `pollLiveSync` now fast-fails after 3 consecutive `unknown` polls (the sync_run is pre-created before the workflow starts, so persistent unknown = real fault).

### Memorable element drifted: contract says SUPPLIERS → ORDERED → IN TRANSIT; shipped CATALOG → SUPPLIERS → SALES
- **Decision:** Keep the new sequence for now; update the contract so it's correct. May revisit if it doesn't fit alongside inventory-controls surfaces.
- **Action:** Updated FEATURES.md memorable spec + added a dated contract note. No code change.

### Full Block 6 not delivered end-to-end (incremental/webhook/conflict/PO-write/SLO/Playwright/action-tests/raw-px)
- **Decision:** Ticket as Wave 6.2b slice boundary (Wave 6.3 + standing tickets).
- **Action:** Appended to `_reviews/_tickets.md` under "Block 6 Wave 6.2b — Codex round-1 tickets (2026-06-06)".

### Skill compliance "partial" — `feature-dev` has no registry entry
- **Decision:** Non-issue (feature build has no declared-artifact skill contract). Ignore.

### Push?
- **Decision:** Ticket rest + push.
