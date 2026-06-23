# Evidence — feature: PO write-back prove + polish (2026-06-23)

**Phase:** 6 (Features) · **Branch:** `feature/po-writeback-prove-polish` · **Project:** The Chain (MoreTech Product)

Block 11b shipped the PO→QuickBooks write-back on 2026-06-13, but its happy path was unproven: the `sent` branch (a PO actually pushed to QBO) had zero automated coverage and the 11b live-verify only exercised the `exported` degrade path. This wave proves it and surfaces supplier reliability on the decision page.

## What was built

1. **Sent-path test coverage.** `src/lib/purchase-orders/approve-core.ts` now takes an optional `ApproveDeps.createAdapter` seam (defaults to the real `createQboAdapterForTenant` — production behavior unchanged; the codebase's standard transport/token injection idiom). `tests/purchase-orders/approve-core.test.ts` adds 3 integration cases (real local Supabase):
   - QBO-mapped supplier + SKU + connected → adapter `push()` succeeds → status `sent`, `external_po_id` + `external_reference` (DocNumber) persisted, ordered qty committed as `in_transit`.
   - Mapped + connected but `push()` throws → degrades to `exported`, `external_po_id` stays null, in-transit still committed (resilience contract).
   - Mapped but factory returns null (not connected) → `exported`.

2. **Supplier reliability panel on the PO hero** (FEATURES.md:451). `src/app/(app)/purchase-orders/[poId]/SupplierReliabilityPanel.tsx` (extracted component) renders between the order-chain hero and the lines: `ReliabilityRibbon` + rolling-30d OTIF / on-time / in-full + actual lead time ±σ + sample size + a "Full scorecard →" link. Reuses `getSupplierDetail` and the audited ribbon — no duplicated read. Loaded in parallel with the reorder context in `page.tsx`.

## Verification

**Static gates:** `npm run typecheck` clean · `biome check` clean (after format) · `npm run build` clean (PO route builds as PPR `◐`).

**Automated tests:** full suite **669/669** green (was 664). New: 3 cases in `approve-core.test.ts` (sent / degrade / not-connected) + `tests/purchase-orders/supplier-reliability-panel.memorable.test.tsx` (2 cases: ribbon forms from history + reads the scorecard; never-delivered supplier shows pending ribbon + honest em-dash stats).

**Live browser verification** (dev `:3100`, throwaway local tenant `po-reliability-verify@thechain.test`, subscription set active to clear the Block 16 paywall; rows local-only, wiped on next `db reset`). Seeded a supplier with a rolling-30d scorecard + 5 delivery-history rows + a draft PO (PO-3310, 2 lines). Loaded `/purchase-orders/<id>` and asserted via DOM:
- Panel renders between the chain hero and the lines. Header "SUPPLIER · Bayou Components LLC" with "Full scorecard →".
- Ribbon: caption "Last 8 deliveries — newest first"; tiles render cobalt (OTIF) / red (late) / amber (short) in the seeded order, plus pending placeholders.
- OTIF (30D) **82%**, on-time **90%**, in-full **88%**; lead time (actual) **6.4 days ±1.2 σ · 11 POs**.
- **Zero console errors** (`preview_console_logs` level=error → none).
- Screenshot captured live (note: `preview_screenshot` returns inline only, does not write to disk in this env — see 2026-06-03 gotcha; DOM assertions above are the evidence of record).

A seed-data bug was caught during verification (not a code bug): `supplier_performance.po_id` is NOT NULL, so the first seed's history rows failed silently and the ribbon showed "No delivery history yet" while OTIF stats rendered. Backfilled with a valid `po_id` → ribbon populated. This confirms the panel wiring reads `supplier_performance` (tiles) and `supplier_scorecards` (stats) independently and correctly.

## Codex gate

`_reviews/2026-06-23_feature_po_writeback_prove_polish.md` (gpt-5.4, Phase-6 full weight). Dispositions in that file's `## Decisions` section. In-slice fixes: this evidence file, FEATURES.md contract reconciliation (line 460), `SupplierReliabilityPanel` extracted + UI render test added. Pushed back: raw-px in `po-detail.module.css` (standing house-style disposition, ticketed for the stack audit; new classes use tokens for color/spacing, px only for font-size per the file's documented convention).

## Still open (not code)

- **Live acceptance:** a real PO landing in the Intuit sandbox via the `sent` path needs an operator Intuit login (same as prior QBO acceptance steps). The path is now test-proven; this confirms it end-to-end against real QuickBooks.
