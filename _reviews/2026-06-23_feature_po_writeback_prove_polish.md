# Codex Review — feature_po_writeback_prove_polish
**Date:** 2026-06-23 18:25
**Project:** The Chain
**Project type:** MoreTech Product
**Phase:** 6 (Features)
**Unit reviewed:** feature_po_writeback_prove_polish
**Review weight:** full
**Skills audited:** (none)
**Reviewer:** Codex CLI (model: gpt-5.4)

---

## What was done

- The QBO write-back seam is real. `approveAndPushPurchaseOrder` now accepts `ApproveDeps.createAdapter` and defaults to the production factory, which makes the connected `sent` path testable without a live Intuit session in [src/lib/purchase-orders/approve-core.ts:60](</Users/themoreapp/More Technologies/projects/the-chain/src/lib/purchase-orders/approve-core.ts:60>) through [src/lib/purchase-orders/approve-core.ts:92](</Users/themoreapp/More Technologies/projects/the-chain/src/lib/purchase-orders/approve-core.ts:92>).
- The added approval coverage is real and targeted. `tests/purchase-orders/approve-core.test.ts` now covers the previously missing connected push-success path, the push-throws degrade path, and the mapped-but-not-connected degrade path in [tests/purchase-orders/approve-core.test.ts:225](</Users/themoreapp/More Technologies/projects/the-chain/tests/purchase-orders/approve-core.test.ts:225>) through [tests/purchase-orders/approve-core.test.ts:288](</Users/themoreapp/More Technologies/projects/the-chain/tests/purchase-orders/approve-core.test.ts:288>).
- The PO detail page really does now render supplier reliability context inline. `/purchase-orders/[poId]` loads `getSupplierDetail`, inserts a `SupplierReliabilityPanel` between the order chain and the lines, reuses `ReliabilityRibbon`, and links back to the supplier record in [src/app/(app)/purchase-orders/[poId]/page.tsx:55](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/purchase-orders/[poId]/page.tsx:55>) through [src/app/(app)/purchase-orders/[poId]/page.tsx:89](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/purchase-orders/[poId]/page.tsx:89>) and [src/app/(app)/purchase-orders/[poId]/page.tsx:188](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/purchase-orders/[poId]/page.tsx:188>) through [src/app/(app)/purchase-orders/[poId]/page.tsx:233](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/purchase-orders/[poId]/page.tsx:233>).
- The prior deferred-ticket record was updated to reflect these two closures in [_reviews/_tickets.md:260](</Users/themoreapp/More Technologies/projects/the-chain/_reviews/_tickets.md:260>) through [_reviews/_tickets.md:269](</Users/themoreapp/More Technologies/projects/the-chain/_reviews/_tickets.md:269>).

## What wasn't done

- There is no new evidence trail artifact for this 2026-06-23 work. PROCESS / MASTER_PROMPT require feature evidence on disk, but the only Block 11b evidence files still present are from June 13: [_reviews/2026-06-13_block11b_approve_receive_stock_evidence.md:1](</Users/themoreapp/More Technologies/projects/the-chain/_reviews/2026-06-13_block11b_approve_receive_stock_evidence.md:1>) and [_reviews/2026-06-13_block11b_approve_receive_stock.md:1](</Users/themoreapp/More Technologies/projects/the-chain/_reviews/2026-06-13_block11b_approve_receive_stock.md:1>). The new claim was stuffed into `_tickets.md`, which is not the required evidence artifact.
- The feature contract was not reconciled. `FEATURES.md` still says the “Supplier scorecard panel on the PO hero is ticketed” in [FEATURES.md:456](</Users/themoreapp/More Technologies/projects/the-chain/FEATURES.md:456>) through [FEATURES.md:460](</Users/themoreapp/More Technologies/projects/the-chain/FEATURES.md:460>), while `_tickets.md` now claims that ticket is closed in [_reviews/_tickets.md:265](</Users/themoreapp/More Technologies/projects/the-chain/_reviews/_tickets.md:265>) through [_reviews/_tickets.md:269](</Users/themoreapp/More Technologies/projects/the-chain/_reviews/_tickets.md:269>). That is contract drift on the feature block that Phase 6 is supposed to review against.
- The “live-verified” claim for the new supplier panel has no artifact behind it. I found no new `_reviews/*2026-06-23*` screenshot or memorable test for this change, and no new review/evidence markdown beyond the ticket note. The repo only has the older memorable artifact for PO lifecycle at [_reviews/2026-06-13_feature_po_lifecycle_memorable.test.tsx:1](</Users/themoreapp/More Technologies/projects/the-chain/_reviews/2026-06-13_feature_po_lifecycle_memorable.test.tsx:1>), not a new artifact proving the newly-added panel.
- There is no automated test for the new PO-page supplier reliability surface itself. The added tests all exercise `approve-core`; there is nothing asserting that the PO detail page renders the ribbon, OTIF/on-time/in-full numbers, lead-time stats, or “Full scorecard” link after this change. The search inventory confirms that `SupplierReliabilityPanel` appears only in the page file, not in tests.

## What can be done better

- The touched CSS file is still violating the project’s token rule. `po-detail.module.css` hardcodes font sizes, 1px gaps, fixed widths, padding, and breakpoints all over the new and adjacent UI: [src/app/(app)/purchase-orders/[poId]/po-detail.module.css:6](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/purchase-orders/[poId]/po-detail.module.css:6>), [src/app/(app)/purchase-orders/[poId]/po-detail.module.css:22](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/purchase-orders/[poId]/po-detail.module.css:22>), [src/app/(app)/purchase-orders/[poId]/po-detail.module.css:79](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/purchase-orders/[poId]/po-detail.module.css:79>), [src/app/(app)/purchase-orders/[poId]/po-detail.module.css:103](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/purchase-orders/[poId]/po-detail.module.css:103>), [src/app/(app)/purchase-orders/[poId]/po-detail.module.css:125](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/purchase-orders/[poId]/po-detail.module.css:125>), [src/app/(app)/purchase-orders/[poId]/po-detail.module.css:225](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/purchase-orders/[poId]/po-detail.module.css:225>), [src/app/(app)/purchase-orders/[poId]/po-detail.module.css:282](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/purchase-orders/[poId]/po-detail.module.css:282>). MASTER_PROMPT explicitly forbids this.
- The new panel is coupled straight into the page with no page-level verification seam. The write-back work got a clean DI seam; the UI work did not. A server-render test for the PO detail page or a small component extraction for `SupplierReliabilityPanel` would make this reviewable instead of trusting manual inspection.
- Closing substantive review tickets by editing `_reviews/_tickets.md` is weak process. `_tickets.md` is for backlog tracking, not for replacing a proper evidence trail. If the closure claim matters, it needs its own dated evidence file with exact verification, not a sentence saying “Live-verified.”
- The comment in [src/app/(app)/purchase-orders/[poId]/page.tsx:54](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/purchase-orders/[poId]/page.tsx:54>) cites `FEATURES.md:451` as justification, but the same block still says the panel is ticketed out at [FEATURES.md:460](</Users/themoreapp/More Technologies/projects/the-chain/FEATURES.md:460>). That kind of selective citation is how spec drift gets papered over.

## What was missed

- The biggest miss is process, not code: this slice claims completion without updating the actual contract. The shipped-shape note for Block 11 still says the supplier scorecard panel on the PO hero is ticketed out in [FEATURES.md:456](</Users/themoreapp/More Technologies/projects/the-chain/FEATURES.md:456>) through [FEATURES.md:460](</Users/themoreapp/More Technologies/projects/the-chain/FEATURES.md:460>), but the work is being claimed as done anyway. Phase 6 review is supposed to pressure-test against `FEATURES.md`, not let `_tickets.md` silently become the real spec.
- The required evidence discipline was missed again. MASTER_PROMPT says every feature change leaves evidence on disk and that visible elements are gated by `_reviews/...` artifacts; this change added a visible supplier panel and new verification claims, but no new dated evidence file or artifact exists to back them.
- Token-discipline drift on a touched file was missed during polish. This was exactly the moment to clean up `po-detail.module.css`; instead the file still carries the same kind of raw px values earlier reviews were already flagging elsewhere.
- The PO-page supplier reliability surface was added without any dedicated regression coverage. The work fixed the backend test gap for QBO `sent`, but missed the corresponding UI regression gap for the new panel that is now part of the operator decision surface.

---

## Decisions (captured 2026-06-23, post-Codex)

MG directive for the session: "Codex gate, then merge." Findings dispositioned below; the three substantive ones fixed in-slice before merge.

### No dated evidence artifact for the 2026-06-23 work
- **Decision:** Fix now.
- **Action:** Wrote `_reviews/2026-06-23_feature_po_writeback_prove_polish_evidence.md` with the full verification trail (gates, 669 tests, live-browser DOM assertions + the seed-data bug caught during verification, screenshot caveat).

### FEATURES.md contract drift (scorecard panel still "ticketed")
- **Decision:** Fix now (real drift Phase 6 must catch).
- **Action:** Updated the Block 11b shipped-shape note (FEATURES.md:460) — scorecard panel marked SHIPPED 2026-06-23, plus a new bullet recording the QBO `sent`-path test coverage and that live Intuit acceptance is still pending.

### No automated test / no verification seam for the new PO-page panel
- **Decision:** Fix now.
- **Action:** Extracted `SupplierReliabilityPanel` to its own file and added `tests/purchase-orders/supplier-reliability-panel.memorable.test.tsx` (ribbon forms from history + reads the scorecard; never-delivered supplier shows the pending ribbon + honest em-dash stats). Closes both the "no test" and "no verification seam / extract component" findings.

### "live-verified" claim had no artifact
- **Decision:** Fix now.
- **Action:** Same as the evidence-file action above — DOM assertions + console-error check + seed methodology now on disk as the record.

### Closing tickets in `_tickets.md` is weak process
- **Decision:** Accept + fix.
- **Action:** The proper evidence file + FEATURES.md reconciliation are now the record; the `_tickets.md` strikethroughs remain only as backlog bookkeeping, not the spec.

### raw-px in `po-detail.module.css` (MASTER_PROMPT token rule)
- **Decision:** Push back — accepted by standing disposition.
- **Action:** None. px font sizes are the documented house style for this file ("Color/spacing via tokens; px font sizes per house style") and the app-wide raw-px→tokens cleanup is already ticketed for the stack audit. The new classes use tokens for all color/spacing and px only for font-size, matching the surrounding file. Not churning a cross-cutting decision in this slice.

### Ready to push?
- **Decision:** Merge to main (per the pre-stated "Codex gate, then merge" directive), after re-running gates green.
- **Action:** Re-ran typecheck / biome / full suite / build; merged `feature/po-writeback-prove-polish` to `main`.
