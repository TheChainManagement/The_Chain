# Item 3 slice 2: RFQ bench — build evidence (2026-07-12)

Branch: `feature/item3-w2-3-procurement` (local, not pushed; awaiting MG review per the gate).
Scope: design doc §10 slice 2 = RFQ create (by hand + from reorder selection), lines,
vendor set, send (export-for-manual-send), status flow. Quote entry/comparison is slice 3.

## Surfaces

- **Nav**: `Procurement` added to `NAV_ITEMS` (visible in every mode; the profile
  relabel/hide seam applies as usual).
- **/procurement** — the RFQ ledger: title + location, the compact **RFQ chain track**
  (DRAFTED · SENT · QUOTED · CLOSED, reached nodes cobalt, canceled = a stop node where
  the document died), line/vendor counts, quoted x/y, respond-by. `NewRfq` disclosure
  (AddSupplier idiom): title + location + respond-by, lands on the detail bench.
- **/procurement/rfqs/[rfqId]** — the working document. Draft: add-line rail with the
  count-sheet SKU datalist + qty + note, removable lines, vendor picker (only vendors
  not already on the request), Cancel/Mark sent (send disabled until >=1 line AND >=1
  vendor, the reason in the tooltip). Sent: document locks (every edit affordance
  drops), per-vendor documents go live. Close from sent/quoted.
- **Per-vendor documents** (design §7.2, export-for-manual-send):
  - `/api/exports/procurement/rfq/[rfqId]/[supplierId]` — CSV with a vendor-readable
    header block + line table + blank "your unit price"/"your lead time" columns.
    Formula-injection guarded, RLS-scoped, vendor-slug filename.
  - `/print/rfq/[rfqId]/[supplierId]` — letterhead print sheet OUTSIDE the (app)
    segment (no rails): masthead, vendor/deliver-to/respond-by grid, line table with
    blank quote columns, print button (hidden by print media). Auth + RLS enforced.
- **Reorder hook**: the queue's bulk bar gains **Request quotes** beside Create
  purchase order. Same fenced selection becomes a draft RFQ (lines from the
  recommendations, the group's supplier pre-filled); recommendations stay OPEN
  (quoting precedes ordering).

## Server layer

- `src/lib/procurement/transform.ts` — pure validation, status-transition guards
  (send/close/cancel/edit), `buildRfqChain`, `rfqToVendorCsv`, error mapping.
- `src/lib/procurement/queries.ts` — RLS-scoped reads (list, detail, SKU + location
  options).
- `src/app/(app)/procurement/actions.ts` — createRfq, add/removeRfqLine,
  add/removeRfqVendor, sendRfq, closeRfq, cancelRfq, createRfqFromRecommendations.
  All through the RLS member client (owner|manager|planner per W2-3a policies);
  role check up front is the friendly-error layer. **Zero balance writes** (design §1).

## Live walkthrough (dev server :3100, storeroom demo tenant, this session)

Created "Bolt restock quotes" → added line BLT-M12-50 × 100 (datalist) → added vendor
Gulf Coast Fasteners → Mark sent enabled only once both existed → sent (chain lit 2
nodes, sent date stamped, document locked) → CSV verified byte-for-byte (header block +
line row, vendor-slug filename) → print sheet renders as a clean letterhead document.
Bench ledger shows the request with chain/counts. Preview-pane screenshots reviewed
in-session; the RTL interaction tests below are the durable driveable artifacts (repo
precedent).

## Tests (+23; suite 839/839, tsc/biome/craft clean)

- `tests/procurement/transform.test.ts` (16): validation, every status transition,
  chain builder incl. the canceled stop node, CSV header/escaping/formula-guard.
- `tests/procurement/rfq-workbench.test.tsx` (6): draft add-line rail wired to the
  datalist, vendor picker excludes vendors already on the bench, Mark sent gated with
  the named reason, send fires, sent locks all edit affordances, vendor rows become
  their documents (CSV + print hrefs).
- `tests/reorder/queue-request-quotes.test.tsx` (2): fenced selection → RFQ action →
  lands on the draft; disabled with nothing selected.

## What's memorable (slice level)

The RFQ chain track: the same diamond-node chain language as the PO OrderTrack, and a
canceled request shows an honest red stop node where the document died. (The Item-level
memorable, the quote comparison grid, is slice 3 by design.)

## Flags for MG review

1. The storeroom demo tenant had NO suppliers; I seeded one locally
   (Gulf Coast Fasteners) to drive the walkthrough. The already-ticketed demo-seed
   extension should add suppliers + a case-packed PO alongside.
2. "Mark sent" wording: chosen over "Send" because nothing leaves the app (the export
   documents are the send). Say the word if you want different language.
3. RFQ create from reorder stamps a dated default title ("Reorder quotes YYYY-MM-DD"),
   editable later only by cancel/recreate this slice (title edit is trivial to add if
   you want it).

## Next

Slice 3: quote entry + the comparison grid (the memorable element: cheapest cells
ignite cobalt per row, picks assemble the requisition in a side rail).
