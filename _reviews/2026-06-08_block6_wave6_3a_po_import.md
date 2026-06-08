# Codex Review — block6_wave6_3a_po_import
**Date:** 2026-06-08 17:24
**Project:** The Chain
**Project type:** MoreTech Product
**Phase:** 6 (Features)
**Unit reviewed:** block6_wave6_3a_po_import
**Review weight:** full
**Skills audited:** none
**Reviewer:** Codex CLI (model: gpt-5.4)

---

## What was done

- The PO-import slice is real. `sync-core` now has a fourth durable phase, `purchase_order`, after products/suppliers/movements, and it writes headers plus lines into `purchase_orders` / `purchase_order_lines` instead of just counting them (`src/lib/qbo/sync-core.ts:59-63`, `src/lib/qbo/sync-core.ts:348-467`).
- The schema support for that slice exists on disk. `supabase/migrations/20260608120000_block6_po_import.sql` adds the `(tenant_id, external_po_id)` unique index and `external_reference` column (`supabase/migrations/20260608120000_block6_po_import.sql:15-21`).
- The QBO mapper now carries the operator-facing DocNumber into the canonical PO payload as `reference` (`src/lib/qbo/map.ts:155-190`, `src/lib/source-adapter/canonical.ts` per the diff context).
- There is a real PO read surface. `/purchase-orders` exists, renders metrics plus a featured chain/ledger, and the supplier detail page now reads and renders supplier-scoped POs (`src/app/(app)/purchase-orders/page.tsx:29-160`, `src/app/(app)/suppliers/[supplierId]/page.tsx:35-118`, `src/lib/purchase-orders/queries.ts:23-52`).
- Supplier contact enrichment is real. `syncSuppliers` now persists merged `contact` plus `qbo_vendor_id`, and the supplier detail contact panel renders it (`src/lib/qbo/sync-core.ts:216-253`, `src/app/(app)/suppliers/[supplierId]/page.tsx:156-182`).
- There is real verification for the slice, but only at the sync-core/unit level. `tests/qbo/sync-core.test.ts` proves headers/lines import and idempotent re-run, and `tests/purchase-orders/order-chain.memorable.test.tsx` proves the chain state mapping in jsdom (`tests/qbo/sync-core.test.ts:105-215`, `tests/purchase-orders/order-chain.memorable.test.tsx:31-67`).

## What wasn't done

- Block 6 is still not delivered against its own contract. The feature requires `qboIncrementalSyncWorkflow`, 15-minute cron in `vercel.ts`, Intuit auto-webhook handling via `createWebhook()`, conflict resolution surfaced in `/app/flow/sync-conflicts`, and `resolveSyncConflict(...)` (`FEATURES.md:271-289`). Those artifacts are still absent from `src/` and `tests/`; repo search only finds the initial-sync path plus seed/foundation references to `sync_conflicts`, not the actual Block 6 implementation.
- Generated PO write-back is still not wired end-to-end in production, even though the block requires it (`FEATURES.md:269`, `FEATURES.md:279`, `FEATURES.md:286`). The adapter tests exist, but this slice only imports external POs; nothing in the shipped code drives the push path from app/workflow code.
- The required memorable artifact is still not delivered in the required form. The contract requires a preview screenshot or Playwright interaction test for the connect screen (`FEATURES.md:290-292`). What exists is a jsdom Vitest file for the PO chain (`tests/purchase-orders/order-chain.memorable.test.tsx:1-67`), which is not a Playwright interaction test and not the connect-screen artifact the block requires.
- The evidence file claims three screenshots exist, but they are not on disk. `_reviews/2026-06-08_block6-wave6_3a-po-import.md` lists `_reviews/2026-06-08_po_cockpit.png`, `_reviews/2026-06-08_po_supplier_panel.png`, and `_reviews/2026-06-08_supplier_contact_enriched.png` (`_reviews/2026-06-08_block6-wave6_3a-po-import.md:29-32`). Those files are missing; only the `.md` file is present in `_reviews/`.
- Skill-compliance audit is still broken by declaration. The prompt context says the claimed skill is `none`, and there is no registry entry for it. There is no `skill_registry.md` update or any other artifact that would make that audit pass.

## What can be done better

- Stop treating tranche notes as a substitute for the feature contract. The evidence file explicitly narrows this to a “Wave 6.3-A” slice (`_reviews/2026-06-08_block6-wave6_3a-po-import.md:4-6`, `:34-38`), but the review checkpoint is still Block 6 full-contract territory. Either update the checkpoint framing everywhere or stop claiming Block 6 review completion.
- Tighten the verification at the boundary the user actually hits. There is still no action/workflow-level test for `runQboInitialSync` / `getQboSyncProgress`; the new coverage lives below that in `sync-core` and pure UI tests (`src/app/(app)/integrations/actions.ts:130-194`, `tests/qbo/sync-core.test.ts:105-215`). That keeps the riskiest path under-tested.
- The evidence discipline is sloppy. Claiming screenshot artifacts that do not exist on disk is exactly the kind of thing the project doctrine says not to do. The review trail needs to match the filesystem, not the intent.
- The contract/docs are now drifting. `FEATURES.md` still says the memorable sync chain ends with POs being “read-only-counted” and “write-back is Wave 6.3” (`FEATURES.md:292`), while this slice now writes POs into the catalog. That mismatch makes future reviews unreliable.

## What was missed

- The PO import can silently write a truncated order. In `syncPurchaseOrders`, each line whose product cannot be resolved is converted to `null` and filtered out (`src/lib/qbo/sync-core.ts:378-389`). If at least one line survives, the PO is still staged and imported (`src/lib/qbo/sync-core.ts:395-460`). That means one broken product mapping can yield a partial PO in `purchase_order_lines` with no failure row for the missing line. That is a real data-loss bug, not a polish issue.
- The convergence claim for shrunk POs is not actually proven. The evidence file says line upsert + tail-prune makes a shorter re-sync converge (`_reviews/2026-06-08_block6-wave6_3a-po-import.md:18`), but `tests/qbo/sync-core.test.ts` never mutates a previously-longer PO and re-runs to prove stale lines are removed (`tests/qbo/sync-core.test.ts:163-215`). The code has the prune loop; the proof does not.
- The block’s required memorable artifact is still being substituted, again. Block 6 requires the live connect-screen chain in pre-connect / mid-sync / post-sync states (`FEATURES.md:292`). This slice added a different memorable surface: the `/purchase-orders` cockpit chain plus a supplier panel (`src/app/(app)/purchase-orders/page.tsx:23-28`, `_reviews/2026-06-08_block6-wave6_3a-po-import.md:19-20`, `:30-31`). That may be useful, but it is not the contracted artifact.
- The feature contract was not updated after behavior changed. `FEATURES.md:292` still describes POs as read-only-counted, but `sync-core` now writes them into `purchase_orders` as a real import phase (`src/lib/qbo/sync-core.ts:348-467`). Reviewing against a stale contract is how bad assumptions survive.
