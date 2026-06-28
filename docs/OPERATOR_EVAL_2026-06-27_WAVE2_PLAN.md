# The Chain: Operator Eval + Wave 2 Plan

Captured 2026-06-27 from MG's first hands-on walkthrough of the live product. Every
"can it do this today" answer below was verified against the actual code, not assumed.

Lens worth naming up front: MG evaluated the app as a **maintenance / MRO spare-parts
storeroom** (issue parts to a crew, request quotes, approve a requisition, receive a PO).
The Chain was built as a **distribution / resale inventory** product (QuickBooks sales =
demand signal, reorder for resale). The forecasting + reorder engine carries over cleanly,
but three storeroom-shaped workflows (issue-out, RFQ/quote, requisition-before-PO) are not
built. That is the heart of Wave 2.

---

## 1. Capability snapshot (today)

| Area | Today | Verdict |
|------|-------|---------|
| Create a PO without QuickBooks | reorder queue -> draft PO -> approve -> status `exported` | WORKS |
| Receive a PO in-app (manual) | PO detail -> Receive controls; writes a receipt movement, moves on_hand/in_transit | WORKS |
| Forecasting -> reorder point -> recommendation | full engine (ABC/XYZ, statistical forecast, safety stock, ROP) | WORKS |
| Unit of measure | free-text field on the product (placeholder "each") | WORKS, but no dropdown |
| Supplier contact | email + phone (stored as JSON), set in the edit form | PARTIAL (no address, no contact person) |
| Lead time | stored on BOTH the supplier (default) AND the product-to-supplier link (per item) | WORKS, wrong emphasis |
| MOQ (min order qty) | on the product-to-supplier link | WORKS, AI-only today |
| Min order value ($) | on the supplier | WORKS, wrong placement per MG |
| Reorder qty / min / max | computed into the policy (AI), user can tune service level + lead time | PARTIAL (no user-authored min/max) |
| Issue material OUT (storeroom) | only via an imported negative movement; no in-app "issue" action | GAP |
| RFQ / quote request to a vendor | none | GAP |
| Purchase requisition before a PO | none (recommendation goes straight to PO) | GAP |
| Capture vendor-returned prices | none | GAP |

---

## 2. Scenario walkthroughs

### Scenario C (do this first, it works): create + receive a PO without QuickBooks
QuickBooks is NOT required to create or receive POs. It is one optional source for
importing and writing back, nothing more.

Walkthrough today:
1. Get demand history in (CSV import of sales/movements) so the engine can compute a
   reorder point. (Note: each SKU also needs a primary supplier with a unit cost before a
   PO can be built. See the data-limitation note in section 5.)
2. Go to **Reorder**. SKUs below their reorder point appear, grouped by supplier + location.
3. Select a group, click **Create purchase order**. A draft PO is created in-app.
4. Open the PO, click **Approve**. With no QuickBooks connected it moves to `exported`
   (a CSV is available to send to the vendor manually). With QuickBooks connected it would
   push to QBO and move to `sent`. Approve also moves the ordered qty into `in_transit`.
5. When the goods arrive, open the PO, click **Receive**, enter the delivery date and the
   received quantity per line. Stock moves into `on_hand`, `in_transit` draws down, and the
   supplier scorecard records on-time / in-full.

Verdict: fully supported today, no QuickBooks needed.

### Scenario A (not built): RFQ -> vendor prices -> requisition -> approve -> PO
None of this exists today. The current flow goes straight from a system recommendation to a
draft PO. There is no concept of:
- sending a quote request to one or more vendors,
- capturing the prices a vendor sends back,
- a purchase requisition that is a separate, approvable document before it becomes a PO.

This is the largest single Wave 2 build. Sized in section 4 (Phase W2-3).

### Scenario B (not built as a feature, has a manual workaround): issue material out
There is no in-app "issue these parts to a crew" action. The database supports the movement
types `sale`, `receipt`, `transfer_in`, `transfer_out`, `adjustment`, `cycle_count`, but only
`receipt` (from receiving) and `sale` (from import / QuickBooks) have any UI.

Workaround today: CSV-import a movement row with a negative quantity (type `sale` or
`adjustment`) to draw stock down. That proves the data model handles it, but it is not an
operator workflow.

What a real storeroom needs (Wave 2, Phase W2-1): an "Issue" action on a SKU (and a bulk
issue ticket), capturing who/what it was issued to (crew, work order, cost center), writing
an `adjustment`/issue movement, and decrementing on_hand. Plus the matching "Adjust" and
"Cycle count" actions, since the enum already anticipates them.

---

## 3. Observations -> fixes (themed)

1. **Unit of measure should be a dropdown** with label + abbreviation (each / EA, box / BX,
   roll / RL, case / CS, etc.), not free text. Keep a free-text "other" escape hatch.
2. **Supplier = contact record.** Add address and contact-person to the existing email +
   phone. Used for invoicing and contact.
3. **Lead time belongs to the item, not the vendor.** The per-(product, supplier) lead time
   already exists in the data model and is the right home. Stop presenting a single lead time
   on the supplier page; surface it on the product (and per supplier link). The policy engine
   should read the per-item value first.
4. **Ordering parameters move off the vendor.** MOQ, reorder qty, min/max belong to the item
   or its policy, not to the supplier. The supplier keeps contact + terms only.
5. **User-authored policy, AI-assisted.** Let the operator set MOQ, reorder qty, and a
   min/max band by hand. AI then suggests adjustments (and flags when the operator's numbers
   look risky), rather than owning the numbers outright. Surface this on the SKU's
   replenishment policy panel.

---

## 4. Wave 2 plan (sequenced, no work started)

Each phase is its own build with the normal per-feature gate (build -> screenshot -> MG ->
review -> push). Ordered by value-to-effort for MG's storeroom use case.

- **W2-1: Storeroom movements (issue / adjust / cycle count).** The biggest functional gap
  for a maintenance warehouse. Manual issue-out with a reason/work-order tag, manual stock
  adjustment, and cycle-count entry. Builds on the existing movement enum + ledger.
- **W2-2: Supplier + item data model cleanup.** UoM dropdown; supplier address +
  contact-person; move lead time / MOQ / min-max emphasis onto the item; user-authored
  policy with AI-suggested deltas. Several of MG's observations land here together.
- **W2-3: Procurement workflow (RFQ -> requisition -> PO).** The new documents: a quote
  request to vendors, captured vendor prices, a requisition that is approved and then becomes
  a PO. The deepest build; do it after the data model is right.
- **W2-4: Bulk product-to-supplier linking via import.** Today products, suppliers, and
  movements import; the product-to-supplier link (cost, lead time, MOQ) does not. Add that
  lane so a real catalog can be loaded end to end from spreadsheets.

Sequencing logic: W2-1 unblocks MG's core use case fastest. W2-2 fixes the data model before
W2-3 builds procurement documents on top of it. W2-4 removes the manual-linking friction
section 5 describes.

---

## 5. Test data (ready now)

Three files, headers already matched to the importer so they auto-map. Local copies for
direct upload live in `samples/test-data/`; Google Sheets copies are in MG's Drive.

- **Products** (100 MRO SKUs, 10 different units of measure): `samples/test-data/Products.csv`
- **Vendors** (12 industrial suppliers): `samples/test-data/Vendors.csv`
- **Sales & movements** (~9k rows, 12 months, varied demand patterns):
  `samples/test-data/Sales-and-Movements.csv`

**Known limitation that affects the test:** the importer covers products, suppliers, and
movements, but NOT the product-to-supplier link (cost, lead time, MOQ). After uploading,
SKUs will have no supplier and no cost, so the reorder -> PO path cannot fully run from the
uploads alone. Two options to get a full end-to-end run:
1. MG links a handful of SKUs to a vendor by hand on the SKU detail page (cost + lead time),
   then runs a recompute, or
2. I seed product-to-supplier links + opening stock for the test tenant directly, then run a
   forecast batch, so the whole engine (forecast -> policy -> reorder -> PO) lights up.
