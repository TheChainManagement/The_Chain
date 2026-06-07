# Block 6 Wave 6.2b — durable QBO initial sync (write into the catalog)

**Date:** 2026-06-06
**Status:** BUILT + live-verified against the real Intuit sandbox. Awaiting MG checkpoint → Codex → push.

## What shipped
The connected "Run sync" stops being a read-only preview and becomes a durable
import that writes the operator's QuickBooks data INTO the catalog.

- **`src/workflows/qbo-sync.ts`** — `qboInitialSyncWorkflow` (`"use workflow"` +
  `"use step"`), mirrors the CSV `importWorkflow`. Manifest now: 7 steps, 3 workflows.
- **`src/lib/qbo/sync-core.ts`** — the write core. Pulls the QBO adapter (same one
  the preview uses) and writes canonical payloads in dependency order:
  items→products (upsert `tenant_id,sku`), vendors→suppliers (upsert `tenant_id,id`
  by `lower(name)`), bills+sales→stock_movements (upsert
  `tenant_id,source,source_ref,occurred_at`, `ignoreDuplicates`). POs pulled
  read-only for the ordered/in-transit chain counts. Runs via the service-role
  admin client (workflow is session-detached); authorized at the action gate.
  - **Crash-safe:** idempotent upserts + per-phase cursor in `sync_runs.cursor`
    (a completed kind is skipped on resume).
  - **QBO-vs-CSV difference handled:** QBO movements reference a product by QBO
    Item Id, so product_id resolves via `products.external_ids->>'qbo'`, not SKU.
    Movements dedup on QBO's real entity ref (`qbo:bill:..`/`qbo:sales:..`).
- **`src/app/(app)/integrations/actions.ts`** — `runQboInitialSync` (gate →
  pre-create sync_run → `start(qboInitialSyncWorkflow)` → tracking key) +
  `getQboSyncProgress` poller. Removed the superseded read-only `runQboLiveSync`.
- **`ConnectPanel.tsx`** — connected "Run sync" kicks the durable run and polls;
  the chain forms link by link (CATALOG → SUPPLIERS → SALES) from REAL phase
  progress (not a timer); on completion the panel shows the written counts and
  links straight into `/inventory` + `/suppliers`. (Craft delta vs 6.2a, which
  said "read-only, nothing written.")
- **No migration** — `stock_movement_source` enum already has `'qbo'`; the dedup
  index `(tenant_id, source, source_ref, occurred_at)` is source-generic.

## Two issues the LIVE data surfaced (fixtures didn't)
1. **Non-inventory sales were miscounted as errors.** The sandbox ("Sandbox
   Company US", a landscaping co) sells mostly service items. A movement for an
   item we didn't sync as a product is a non-inventory line — an expected skip,
   not a failure. First live run showed `errors=45`; fixed to classify these as
   `skipped` (surfaced honestly in the UI: "45 non-inventory lines skipped"),
   leaving `errors=0`.
2. **Movement counts dropped to 0 on a re-run.** Headline counts were scaled by
   "newly inserted this run"; on a re-sync the dedup upsert inserts 0, so it read
   0 sales despite the data being present. Fixed: headline = movements now in the
   catalog (every staged row, present after upsert), stable across fresh + re-run.

## Verification (live, real Intuit sandbox — tenant 7a24e04c…, realm 9341457226280805)
Workflow step exit (re-run): `catalog=4 suppliers=26 receipts=2 sales=18 errors=0`.
DB facts (local Supabase, queried directly):
- products (external_ids.qbo set): **4** — Pump, Rock Fountain, Sprinkler Heads, Sprinkler Pipes
- suppliers (external_ids.qbo set): **26**
- stock_movements source='qbo': **20** (2 receipts + 18 sales), signed qty (sales negative), refs `qbo:sales:96:2` etc.
- latest sync_run: `status=completed, done=true, errors=0, skipped=45`
- Idempotent: re-run left product/supplier/movement row counts unchanged.

## Tests + gates
- `tests/qbo/sync-core.test.ts` (new, integration vs real Supabase): items→products,
  vendors→suppliers, bills+sales→movements; QBO-Item-Id→product resolution;
  source='qbo' + `qbo:` ref; finalize; **idempotent re-run = zero duplicate rows**.
- Memorable artifact updated to the durable flow + the import-nav payoff.
- Suite **246/246**, typecheck + lint clean.

## Notes / follow-ups
- Node: dev verified on Node 22; project wants Node 24 (engines). Switch before
  the Vercel-Preview SLO bench.
- **Ticketed (Wave 6.3-adjacent):** write POs into `purchase_orders` (needs the
  line-item + PO-status model + write-back/conflict policy); 60s OAuth→first-sync
  SLO on a seeded Vercel Preview; supplier contact enrichment from QBO (email/
  phone/web are pulled but not yet persisted); raw-px tokens (stack-audit).
- Stale `sync_failures` (45 rows) from the pre-fix first run remain for this test
  tenant; harmless (no QBO failures view yet), local-only.
