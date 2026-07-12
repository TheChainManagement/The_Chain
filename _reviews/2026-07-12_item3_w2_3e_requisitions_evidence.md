# Item 3 slice 4: requisitions + convert-to-PO — build evidence (2026-07-12)

Branch: `feature/item3-w2-3-procurement` (local, not pushed; awaiting MG review per the gate).
Scope: design doc §10 slice 4 = requisition surfaces, submit/approve/reject with the
locked §7.1 gate, `convert_requisition_to_po` + PO back-links, and the §8 post-award
supplier-link price update. This completes Item 3's functional build (slice 5 =
polish/Codex/walkthrough remains).

## What shipped

- **W2-3d migration** (`20260712160000_w2_3d_convert_requisition_rpc.sql`):
  `convert_requisition_to_po(p_tenant, p_requisition)` — row-locked SECURITY INVOKER
  RPC. Approved requisition → one draft PO per supplier at the requisition's location,
  purchase-UoM lines copied straight across (the basis they already carry),
  `purchase_orders.requisition_id` back-referenced, requisition stamped `converted`.
  Idempotent: replay on a converted document returns the existing POs with
  `out_applied=false`. Documents only — no balance table is touched.
- **Lifecycle guards (pure)**: submit (draft + rejected-resubmit), decide
  (single-step, owner+manager, **requester can never decide their own submission** —
  the MG-locked §7.1 gate, enforced server-side and mirrored in the UI so the
  requester sees WHY), convert (approved only), cancel (draft/submitted/rejected).
  Reject requires a note; the note shows on the document as a red callout and clears
  on resubmit. `buildRequisitionChain`: DRAFTED · SUBMITTED · APPROVED · ORDERED,
  rejection = stop node AT the decision point.
- **Surfaces**: the Procurement bench gains the **Requisitions ledger** (chain, lines,
  vendors, total, created). Requisition detail: meta strip (chain, location, total,
  source RFQ link), lines with vendor + purchase-UoM qty + unit cost + line total,
  status actions per role, converted-POs panel linking to the real PO bench. The RFQ
  drafted-banner now links to its requisitions.
- **Update link price (design §8)**: per costed line, an explicit audited action that
  copies the awarded price + UoM + factor onto the supplier link; reads "Link current"
  once they match. Never automatic — stale link costs are how valuation seeds and
  reorder math drift, but the operator decides.

## Live walkthrough (dev server :3100, storeroom demo tenant, this session)

Opened the $1,347.00 draft requisition from slice 3 → **Submit for approval** (chain
lit 2) → as the requester, the decision buttons were replaced by
"You cannot approve your own requisition." — **the §7.1 gate live**. Detached the
requester (SQL fixture) → Approve appeared → approved (chain lit 3) → **Convert to
purchase orders** → chain fully lit (ORDERED) and the Purchase orders panel showed
the mixed-vendor fan-out: Gulf Coast Fasteners DRAFT · $1,296.00 and Bayou Industrial
Supply DRAFT · $51.00. Clicked through: the requisition-born PO renders as a
first-class PO (chain, scorecard, export) ready for the existing approve → in_transit
→ receive path through the kernel. **The full Scenario A loop is closed: RFQ → quotes
→ award → requisition → approval → POs.**

## Tests (+19; suite 874/874, tsc/biome/craft clean)

- `tests/procurement/requisition-transform.test.ts` (8): every lifecycle guard incl.
  the self-approval block and role fencing; chain states incl. the rejection stop node.
- `tests/procurement/convert-rpc.test.ts` (3, real DB): not-approved refusal;
  approved mixed-vendor fan-out (2 POs, totals 96/50, draft, back-referenced,
  requisition converted, **balances + ledger byte-identical before/after**);
  idempotent replay (existing POs, nothing new).
- `tests/procurement/requisition-workbench.test.tsx` (8, RTL): manager approves,
  reject demands + sends the note, requester sees the self-approval message, planner
  fenced out, approved offers convert, update-link-price fires, "Link current" state.

## Flags for MG review

1. Line editing on a requisition does not exist: the RFQ award flow is the editor.
   A rejected requisition resubmits as-is; to change lines, cancel and re-award.
   Fine for v1? (The kickoff's "edited and resubmitted" is satisfied by the
   cancel/re-award path; direct line editing is a small follow-on if you want it.)
2. Direct (no-RFQ) requisitions are schema-supported but have no create UI yet; the
   design's "direct path" ships when there is a real need. Ticketable.
3. The walkthrough needed a second user to exercise approval honestly; the demo
   tenant has only you. The seed-extension ticket should add a manager member.

## Next

Slice 5 (item close): Codex full-weight review over the branch, your walkthrough,
FEATURES.md W2-3 acceptance boxes finalized, docs sync (WAVE2_SCOPE status,
kickoff Status entry, tickets), then the merge gate on your go (2 migrations to
prod: w2_3a, w2_3a2, w2_3d — order preserved, final files).
