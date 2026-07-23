# Claude independent re-check: W3 checkpoint fix round 3 - 2026-07-22

Scope reviewed: the uncommitted round-3 working tree on `codex/w3-role-spine` (local tip
`d11e2ec`). Tiny diff, exactly as prescribed: the `enforce_requisition_update` tail guard
now exempts only the sanctioned `v_policy_transition`/`v_human_transition` paths, adds
`rejection_note` to the protected set, and three no-GUC forge probes were added. Claude
replayed the schema (`supabase db reset` clean) and ran the full suite.

## VERDICT: NO-GO (round 4) - R3-F1 is fixed; deeper execution exposed three new roots

The guard fix works: every previously red decision-path test now executes past it, and
`tests/inventory/kernel.test.ts` went fully green. But running deeper revealed one real
product bug in the round-2 reorder RPC and two test-side defects. 16 tests red in 3 files;
all trace to exactly three roots (the rest are aborted-transaction cascades).

## R3-F1: CONFIRMED FIXED

Auto-approval and human decisions both work end to end. Ordinary authenticated PATCHes to
`decided_at`, `approved_by_user_id`, and `rejection_note` still raise
`decision_metadata_guarded` (the three new probes pass). The exemption is correctly scoped.

## New findings

### R4-F1 (PRODUCT BUG) - reorder conversion violates the UoM/factor pair invariant

`convert_recommendations_to_requisition` selects
`ps.purchase_uom, coalesce(ps.purchase_to_stock_factor, 1)` and inserts both into
`requisition_lines`. When the supplier link has NO purchase UoM configured
(`purchase_uom` null), the insert carries (null uom, factor 1) and violates
`requisition_lines_uom_factor_pair_check`. Both reorder end-to-end tests fail on the raw
error `new row for relation "requisition_lines" violates check constraint
"requisition_lines_uom_factor_pair_check"` (surfaced to the user as the generic "Could not
submit the purchase request."). Any tenant whose supplier links do not set a purchase UoM
cannot use the new reorder flow at all.

Fix: keep the pair consistent. Only coalesce the factor when `purchase_uom` is non-null;
otherwise insert null/null and use factor 1 for the ordered-qty and total math. Add a test
with a UoM-less supplier link.

### R4-F2 (TEST BUG) - B2 happy-path probe runs the PO application under the wrong role

The named B2 probe's happy path calls `apply_po_approval` as an authenticated planner. That
RPC's in-transit upsert on `inventory_levels` is blocked by RLS for members BY DESIGN
(W2-2.5 kernel contract: members lost balance-table writes; production invokes this seam
via the service-role admin client in `approve-core`). So the probe dies on
`new row violates row-level security policy for table "inventory_levels"` and aborts the
shared client transaction, cascading 5 more tests in the file. The rejection half of the
probe (authenticated direct-PO -> `approved_requisition_required`) is fine and passes.

Fix: run the happy-path application as the service role (the real seam), keeping the
authenticated rejection probe as is. The evidence gate inside the RPC still applies to the
service role, which is the point of B2.

### R4-F3 (TEST BUG) - stale cross-tenant expectation; the stricter B1 error is correct

`schema.test.ts` "cannot create a document with another tenant's location or catalog rows"
passes the OTHER tenant as `p_tenant`, so the round-1 B1 check
(`jwt_tenant_id() is distinct from p_tenant`) now correctly raises
`requisition_creation_forbidden` before the location lookup can raise
`active_location_not_found`. The behavior is strictly better; the expectation is stale.
Cascades take out 8 more tests in the file.

Fix: expect `requisition_creation_forbidden` for the cross-tenant call, and add an
own-tenant + foreign-location variant so `active_location_not_found` stays covered.

## Also verified

- Clean migration replay through the amended `20260722120000`.
- tsc PASS, biome PASS (366 files), craft PASS.
- 976/992 tests green; kernel suite fully green for the first time since round 1.
- Zero-balance invariant intact (unchanged surfaces).

## Gate state

Prod untouched at `362137d`. main untouched. Merge gate closed. Round-4 fix prompt:
`_codex/FIX_W3_CHECKPOINT_ROUND4.md`. One product fix + two test fixes stand between this
branch and a fully green suite; round 4 should close the loop to the MG eight-migration
production gate.
