# Item 3 slice 3: quote entry + comparison grid + award — build evidence (2026-07-12)

Branch: `feature/item3-w2-3-procurement` (local, not pushed; awaiting MG review per the gate).
Scope: design doc §10 slice 3 = quote entry grid, comparison view, award → requisition
draft. This is THE memorable element of Item 3 (design §7.3/§9). Requisition surfaces
(bench, approve/reject, convert-to-PO) are slice 4.

## What shipped

- **The comparison grid** (`QuoteGrid.tsx` on the RFQ detail, live once sent):
  rows = RFQ lines, columns = vendors.
  - An **empty cell is the entry affordance**: one entry panel at a time under the
    grid, pre-filled with the vendor's purchase UoM + factor from the supplier link
    (the quote snapshots its own copy at entry). Fields: unit price (their unit),
    their unit, = stock units, lead days, MOQ, note. Double-click an answered cell
    re-opens it for edit (upsert).
  - **Normalization**: every answered cell shows the quoted price AND the
    per-stock-unit cost (quoted ÷ factor). The **cheapest per-stock-unit cell per
    row carries the cobalt ignite**, so a $24/case-of-12 correctly beats a $3/each
    sticker. Ties light every cell (the operator breaks them).
  - **Picking**: clicking answered cells assembles the award tray (picked count +
    estimated total, purchase basis); a picked cell goes full cobalt. "Award column"
    takes every line that vendor answered. "No bid" settles a pending vendor as
    declined.
  - **Award**: "Draft requisition" creates a DRAFT requisition + lines; the RFQ
    detail shows the drafted banner (bench arrives slice 4). Mixed-vendor awards
    supported (fan out to N POs at conversion).
- **Auto-flip (design §5)**: when every vendor is quoted/declined the RFQ flips
  sent → quoted (server-side, after each save/decline).
- **Award math (pure, `computeAward`)**: line qty converts stock → the winning
  vendor's purchase unit (÷ factor, fractional allowed per MG); unit cost + UoM +
  factor snapshot onto `requisition_lines` — the same purchase basis PO lines use,
  so slice 4's convert is a straight copy. `source_quote_line_no` carries lineage.
  Header insert + lines insert; a lines failure deletes the header (no headless
  documents).
- **W2-3a2 migration** (`20260712150000_w2_3a2_quotes_rfq_fk.sql`): direct
  `rfq_vendor_quotes.rfq_id → rfqs.id` FK. Caught live: without it PostgREST has no
  rfqs↔quotes relationship to embed. Side effect: quotes became a junction table
  between rfqs and rfq_lines/rfq_vendors, so every rfqs embed of those two now
  carries an explicit FK hint (`!rfq_lines_rfq_id_fkey` etc.) — applied across
  queries.ts and actions.ts.

## Live walkthrough (dev server :3100, storeroom demo tenant, this session)

Seeded a two-vendor sent RFQ ("Q3 consumables: two vendors", Gulf Coast Fasteners +
Bayou Industrial Supply, 2 lines). Entered Bayou $28.50/bag lead 10 on line 1 (cell
ignited as the only answer) → entered Gulf $27.00/bag lead 5 → **the ignite moved to
Gulf's cell** and the chain auto-flipped to QUOTED (3 nodes lit) → entered Bayou
$5.10 on line 2 → picked Gulf line 1 + Bayou line 2 (both cells full cobalt, tray
read 2/2 lines · $1,347.00 = 48×27 + 10×5.10) → Draft requisition → banner
"DRAFT · $1347.00", picks cleared.

DB verification: requisition draft (status draft, total 1347.00, requester stamped),
2 lines with the winning vendor + cost + `source_quote_line_no` lineage, audit rows
on requisitions/requisition_lines/rfq_vendor_quotes, and **ZERO stock movements**
for the tenant across the whole flow (the kernel contract, live-proven again).

## Tests (+16; suite 855/855, tsc/biome/craft clean)

- `tests/procurement/quotes-transform.test.ts` (11): canEnterQuotes gates,
  validateQuoteInput (factor-required-with-uom, fractional-capable, int lead/moq),
  perStockUnitCost, buildQuoteRow (cheapest-by-normalized-cost beats sticker price;
  ties light all), computeAward (stock→purchase conversion, rejects empty/unquoted
  picks, mixed-vendor).
- `tests/procurement/quote-grid.memorable.test.tsx` (5) — **the Phase 6
  visible-craft artifact**: ignite on the normalized-cheapest cell, pick-to-tray
  assembly + award fires with the picks, award-column sweep, entry affordance opens
  pre-filled from the link defaults, closed request locks everything.

## Flags for MG review

1. The vendor CSV/print documents still show for a quoted/closed RFQ (harmless;
   an operator may re-send manually). Say the word if you want them draft+sent only.
2. Re-award is allowed while the RFQ is open (each award = a new draft requisition).
   The drafted banner counts them. Slice 4's bench makes the duplicates visible and
   cancelable; if you want a one-award lock instead, that is a small change.
3. Quote entry accepts cost 0 (a vendor can legitimately quote a freebie/sample).

## Next

Slice 4: requisition surfaces — bench + detail, submit/approve/reject with the role
gate (single-step, owner+manager, no self-approval), `convert_requisition_to_po`
RPC + PO back-links, and the post-award supplier-link price update action.
