# Item 3 W2-3 procurement: adversarial review and finish evidence (2026-07-13)

Branch: `feature/item3-w2-3-procurement`

Review range: `origin/main..HEAD`, beginning at pushed tip `fc09b30`. Contract:
`docs/WAVE2_W2-3_PROCUREMENT_DESIGN.md`, signed off by MG 2026-07-12.

## Outcome

Item 3 is functionally complete, review-clean, locally verified from a clean database
replay, and ready for MG's production merge gate. This pass did not touch main, production,
or the production Supabase project.

## Confirmed findings fixed

1. **Cross-tenant parent injection.** New child rows carried `tenant_id`, but several FKs
   referenced parent UUIDs globally. A crafted writer could attach an in-tenant child to a
   different tenant's RFQ or requisition. New composite parent keys and FKs now enforce the
   tenant on every new header/line/vendor/quote/requisition/PO back-reference relationship.
   The exact winning quote now has an enforceable composite lineage reference.
2. **Approval boundary bypass.** The UI and Server Action blocked self-approval, but the
   broad table update policy allowed a direct PostgREST status update. A row-locked
   `decide_requisition` SECURITY INVOKER RPC plus an update trigger now enforce owner or
   manager, submitted-only, decision metadata, required rejection note, and no self-decision
   at the database boundary.
3. **Non-atomic awards.** Header and lines were separate HTTP writes. A manager or planner
   could leave a headless requisition because cleanup required the owner-only delete policy.
   `award_rfq_quotes_to_requisition` now locks authoritative RFQ data and creates the header,
   lines, totals, and quote lineage in one transaction.
4. **Incomplete UoM snapshot chain.** Requisition snapshots were not copied to PO lines, so
   later supplier-link edits could change approval `in_transit` and receipt conversion math.
   PO lines now carry purchase UoM and factor snapshots. Approval and receipt prefer the line
   snapshot, with supplier-link fallback for legacy POs.
5. **Conversion concurrency.** Conversion locked the requisition header but not its source
   lines. It now locks the lines before fan-out, preserves snapshot fields, rounds PO header
   totals consistently, and retains idempotent replay behavior.
6. **MOQ ignored in award totals.** The grid displayed quoted MOQ but both preview and award
   used only converted demand. Award quantity is now `max(stock qty / factor, MOQ)` in the UI,
   pure transform, and atomic database RPC.
7. **Supplier-link refresh incomplete.** "Link current" compared only price and the update
   silently affected zero rows when no link existed. The action now upserts price, purchase
   UoM, and factor; the current-state label compares the full tuple.
8. **Ambiguous UoM snapshot.** Quote validation allowed a factor without a purchase-unit
   name. App validation and database checks now require UoM and factor to be present as a
   pair, or both absent for stock-unit purchasing.

## Contract probes

- Cross-tenant child-to-parent injection is rejected by a composite FK.
- Direct requester approval is rejected by the database RPC and trigger.
- Atomic award proves stock-to-purchase conversion, MOQ, total, exact quote lineage, and zero
  balance writes.
- Mixed-vendor conversion proves two-PO fan-out, totals, line snapshots, backrefs, and
  idempotent replay.
- Changing the supplier link after conversion does not change PO approval conversion; the
  immutable PO-line factor controls `in_transit`.
- RFQ, award, approval, and conversion document paths leave `inventory_levels` and
  `stock_movements` unchanged. Stock effects still begin only at the existing
  `apply_po_approval` kernel surface and receipt posting kernel.

## Verification

- `supabase db reset`: PASS. All migrations replayed in filename order from a clean DB.
- `npx vitest run`: PASS, **879/879** across 122 files.
- `npx tsc --noEmit`: PASS.
- `npm run lint`: PASS, Biome checked 331 source files.
- `node scripts/check-craft.mjs`: PASS.
- `git diff --check`: PASS.

## Intentional deferrals

Dated tickets were added for email-from-app, direct no-RFQ requisition creation UI, direct
requisition line editing, and re-award versioning/one-award policy. These are not required
for the signed-off Scenario A loop and were not built speculatively.

## State of the branch and MG merge gate

The feature branch contains the full Scenario A loop and the review hardening above. The
only remaining work is MG's gate:

1. Walk through the feature branch and review this evidence.
2. Apply these migrations to production in exact filename order:
   - `20260712120000_w2_3a_procurement_schema.sql`
   - `20260712150000_w2_3a2_quotes_rfq_fk.sql`
   - `20260712160000_w2_3d_convert_requisition_rpc.sql`
   - `20260713120000_w2_3_review_hardening.sql`
   - `20260713130000_w2_3_award_moq.sql`
   - `20260713140000_w2_3_uom_snapshot_pair.sql`
3. Re-probe the production schema, RLS relationships, functions, and security advisor.
4. Fast-forward merge to main and probe the production deploy.

Stop condition honored: no production migration, no main merge, and no production deploy was
attempted in this pass.
