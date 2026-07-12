# The Chain: W2-3 Procurement Design (RFQ, Requisition, PO)

*Drafted 2026-07-12 for MG sign-off BEFORE build, per the kickoff doc's ⛔. Model:
the W2-0 mode-spine design pass. Sources: `docs/OPERATOR_EVAL_2026-06-27_WAVE2_PLAN.md`
Scenario A, `docs/WAVE2_SCOPE.md` §4 W2-3 + §5 decision 3, `SYSTEM_DESIGN.md` patterns,
`FEATURES.md` Wave 2 forward contract.*

*Status: **SIGNED OFF by MG 2026-07-12.** All three §7 decisions locked on the
recommendations: 7.1 single-step approval, owner + manager, no self-approval,
thresholds deferred to Wave 3. 7.2 export-for-manual-send; email-from-app is a
fast-follow ticket. 7.3 comparison grid with per-line picks + award-all-to-one.
§4/§5 are now the migration spec; build proceeds per §10.*

---

## 1. Principle

W2-3 is the first true satellite module on the inventory kernel. It creates purchasing
DOCUMENTS (quote requests, quotes, requisitions) that end in the PO lifecycle we already
have. It must not touch stock at all: the only balance writes in the whole flow remain
the existing kernel-surface pair (`apply_po_approval` commits in_transit at PO approval,
`receive_purchase_order` posts receipts through `post_stock_movement`). W2-3 proves the
kernel contract holds for a new module. This is also the natural checkpoint for MG's
reserved veto on in_transit staying kernel-surface.

Everything below follows the existing house patterns: header/line tables, tenant-scoped
RLS with the role matrix, audit triggers, SECURITY INVOKER RPCs for multi-row state
transitions, app-layer role gates in Server Actions.

## 2. What Scenario A actually asks for

An operator (either mode) who wants prices before committing:

1. Pick SKUs (from a reorder recommendation, or by hand) and create an RFQ.
2. Send that RFQ to ONE or SEVERAL vendors (user's choice per RFQ, locked in
   `WAVE2_SCOPE.md` §5.3: both from the start).
3. Capture the prices vendors send back, per line, per vendor, in PURCHASE UoM
   (exists as of W2-2.5).
4. Turn the winning quotes into a REQUISITION: a separate, approvable document.
5. Approval converts the requisition into a draft PO, which then rides the existing
   PO lifecycle (approve → in_transit commit → receive → scorecard).

## 3. Scope / non-scope

**In:** RFQ create/send/close, vendor quote capture (manual entry by the operator),
quote comparison, requisition create/submit/approve/reject, requisition → PO conversion,
audit at every transition, both modes.

**Out (deferred, tracked):** vendor self-serve quote portal, email ingestion of quotes,
supplier price breaks (fast-follow per WAVE2_SCOPE backlog), multi-currency, contract
pricing, blanket POs, approval delegation chains. Requisitions do NOT reserve or
allocate stock.

## 4. Data model (5 new tables, house patterns throughout)

All tables: `tenant_id` scoping, composite FKs on (tenant_id, id), `created_at` /
`updated_at`, RLS per the role matrix, audit triggers via the existing dispatcher.

- **`rfqs`** (header): id, tenant_id, location_id, status `rfq_status`
  (`draft`,`sent`,`quoted`,`closed`,`canceled`), title/note, created_by_user_id,
  sent_at, respond_by (nullable date), created/updated.
- **`rfq_lines`**: rfq_id, line_no, product_id, qty (numeric, STOCK UoM basis with the
  purchase-UoM presentation resolved per vendor link at quote time), note. Unique
  (tenant_id, rfq_id, line_no).
- **`rfq_vendors`**: rfq_id, supplier_id, status (`pending`,`quoted`,`declined`),
  sent_at, responded_at. One row per vendor the RFQ went to. Unique
  (tenant_id, rfq_id, supplier_id).
- **`rfq_vendor_quotes`**: rfq_id, supplier_id, line_no (FK to the rfq_line),
  quoted_unit_cost numeric (PURCHASE UoM), quoted_purchase_uom text,
  purchase_to_stock_factor numeric (snapshot at entry; defaults from the supplier
  link), lead_time_days int, moq int, note, entered_by_user_id, entered_at. Unique
  (tenant_id, rfq_id, supplier_id, line_no).
- **`requisitions`** (header): id, tenant_id, location_id, status `requisition_status`
  (`draft`,`submitted`,`approved`,`rejected`,`converted`,`canceled`), source_rfq_id
  (nullable: requisitions can exist WITHOUT an RFQ for the direct "I know what I want
  approved" path), requested_by_user_id, approved_by_user_id, decided_at,
  rejection_note, total numeric(14,2), created/updated.
- **`requisition_lines`**: requisition_id, line_no, product_id, supplier_id (the CHOSEN
  vendor for that line), qty, unit_cost (PURCHASE UoM), purchase_uom,
  purchase_to_stock_factor (snapshots ride to the PO), source_quote ref (nullable).

Conversion writes `purchase_orders` + `purchase_order_lines` exactly as
`convert_recommendations_to_po` does today (one PO per supplier+location; a
mixed-vendor requisition fans out to N POs), via a new SECURITY INVOKER RPC
`convert_requisition_to_po(p_tenant, p_requisition)` that is row-locked, idempotent
(re-call returns the existing POs), and stamps `requisitions.status='converted'`.
`purchase_orders` gains `requisition_id uuid null` for the back-reference.

**Zero balance writes anywhere in this module.** The probe test asserts it: run the full
RFQ → quote → requisition → approve → convert flow and diff `inventory_levels` +
`stock_movements` before/after (must be identical until PO approval).

## 5. Status lifecycles (all transitions audit-logged, all via RPCs or gated actions)

- RFQ: draft → sent → quoted (auto when every vendor row is quoted/declined, or manual)
  → closed. Cancel from draft/sent.
- Requisition: draft → submitted → approved | rejected; approved → converted.
  Cancel from draft/submitted. Rejected requisitions can be edited and resubmitted
  (new audit row, same document).
- PO: unchanged (`draft` → approval → ... existing lifecycle).

## 6. How it lands in the app

- New left-rail entry **Procurement** (mode-aware label; both modes see it) with two
  benches: RFQs and Requisitions. PO pages stay where they are.
- Reorder page gains "Request quotes" next to "Create purchase order" (same grouped
  selection creates an RFQ instead of a draft PO). Nothing existing moves.
- RFQ detail: lines + the vendor panel + the quote-entry grid (see §7.3).
- Requisition detail: lines with chosen vendor + costs, submit/approve/reject actions
  per role, convert button post-approval, link to the resulting PO(s).

## 7. ⛔ MG DECISIONS (the three that gate the build)

**7.1 Requisition approval rules.**
Recommendation: **single-step approval, owner + manager can approve, requester cannot
approve their own submission** (app-layer gate, same allowlist pattern as issue-out).
No threshold logic this wave: thresholds (e.g. auto-approve under $X) are a Wave 3
roles-layer feature; the schema carries `approved_by_user_id` + `decided_at` so
thresholds bolt on without a migration. Also note: today only the owner role is
UI-exposed, so in practice MG approves everything; the gate wires manager for Wave 3.

**7.2 RFQ delivery: email-from-app vs export-for-manual-send.**
Recommendation: **export-for-manual-send first**. "Send" marks the RFQ sent and
produces a clean per-vendor RFQ document (print-styled page + CSV download) the
operator emails themselves: this matches the existing PO `exported` pattern, needs no
sender-domain/deliverability work, and keeps W2-3 shippable in one wave. Email-from-app
(Resend, per-tenant reply-to) is a fast-follow ticket; the `rfq_vendors.sent_at` /
status shape already supports it.

**7.3 Quote-to-line matching UX.**
Recommendation: **a comparison grid per RFQ**: rows = RFQ lines, columns = vendors,
cells = quoted cost (+ lead time + MOQ on hover/expand), entered manually by the
operator from whatever the vendor sent back. Cheapest cell per row is highlighted;
the operator clicks to pick a winner per line (or "award all to one vendor" in one
action); picks build the requisition draft. This is the "get three quotes" answer on
one bench and doubles as the memorable element candidate.

## 8. Engine touchpoints (read-only)

The comparison grid reads the supplier link (current cost, lead time) alongside quotes
so the operator sees "quoted vs current" per cell. Awarding a quote does NOT rewrite
`product_suppliers`: a post-award "update the supplier link with the awarded price"
one-click is IN scope (explicit user action, audited), since stale link costs are how
valuation seeds and reorder math drift.

## 9. What's memorable (Phase 6 craft gate)

The quote comparison grid: three vendors' answers landing on one bench, cheapest cells
igniting cobalt per row, and the award click assembling the requisition line-by-line in
a side rail as you pick. Artifact: RTL interaction test driving pick → requisition
assembly, plus the walkthrough screenshot.

## 10. Build order once signed off (each slice gated as usual)

1. **Migration slice**: enums + 5 tables + RLS + audit + probe tests (incl. the
   zero-balance-writes probe). `purchase_orders.requisition_id`.
2. **RFQ slice**: create (from reorder selection + by hand), lines, vendor set, send
   (export doc), status flow.
3. **Quote slice**: entry grid, comparison view, award → requisition draft.
4. **Requisition slice**: submit/approve/reject with the role gate,
   `convert_requisition_to_po` RPC, PO back-link, supplier-link price update action.
5. **Polish + Codex + walkthrough**: memorable test, evidence trail, docs sync
   (FEATURES.md W2-3 block gets its acceptance boxes finalized from this doc).

Estimated shape: the deepest Wave 2 build (5 tables, 2 new benches), comparable to
Item 1 + Item 2 combined in surface area, but zero engine/kernel risk by design.

---

*Sign-off checklist for MG: 7.1 approval rule, 7.2 delivery mode, 7.3 grid UX (or
redirect any of them). On sign-off this doc's §4/§5 become the migration spec and
FEATURES.md's W2-3 forward contract gets refined to match.*
