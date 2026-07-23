# Codex Fix List - W3 checkpoint fix round 4

*From Claude's independent re-check 2026-07-22. Full detail:
`_reviews/2026-07-22_w3_checkpoint_fix_round3_claude_verdict.md`.*

## WORKSPACE PREFLIGHT (verify before touching anything)

- Repository: `TheChainManagement/The_Chain`, local path
  `/Users/themoreapp/More Technologies/projects/the-chain`
- Branch: `codex/w3-role-spine`. Round-3 work and this file are committed on it.
- Sanity files that MUST exist:
  `_reviews/2026-07-22_w3_checkpoint_fix_round3_claude_verdict.md` and
  `supabase/migrations/20260722120000_w3_checkpoint_fix_round1.sql`.
- If ANY of the above does not match, STOP and report the mismatch.

Work on `codex/w3-role-spine`. Do NOT merge to main, do NOT apply migrations to any
database, do NOT push main. Status: R3-F1 verified FIXED. Three roots remain - ONE product
bug in the round-2 reorder RPC and TWO test defects. Amend
`20260722120000_w3_checkpoint_fix_round1.sql` in place (still never applied to prod or
main). All standing rules apply.

## MUST FIX

### R4-F1 (PRODUCT BUG) - UoM/factor pair violation in convert_recommendations_to_requisition

The RPC selects `ps.purchase_uom, coalesce(ps.purchase_to_stock_factor, 1)` and inserts the
pair into `requisition_lines`. A supplier link with NULL `purchase_uom` produces
(null, 1), violating `requisition_lines_uom_factor_pair_check`. Every tenant without
purchase UoMs on their links gets "Could not submit the purchase request." for ALL reorder
conversions.

- Keep the pair consistent: when `ps.purchase_uom` is null, insert NULL for both
  `purchase_uom` and `purchase_to_stock_factor`, and use factor 1 only for the ordered-qty
  and total arithmetic. When non-null, keep current behavior.
- Both loops in the RPC (the pricing pass and the insert pass) must agree.
- Add a real-DB test converting a recommendation whose supplier link has no purchase UoM:
  expect success, a requisition line with null uom + null factor, and correct totals.

### R4-F2 (TEST BUG) - run the B2 happy-path application under the service role

In `tests/procurement/approval-policy-rpc.test.ts`, the probe "rejects a direct PO and
accepts one converted from an approved current requisition" calls `apply_po_approval` as an
authenticated planner for the happy path. The in-transit upsert on `inventory_levels` is
RLS-blocked for members BY DESIGN (W2-2.5 kernel contract; production calls this seam via
the service-role admin client). The probe dies on the RLS error and aborts the shared
transaction, cascading 5 more tests.

- Keep the authenticated rejection half exactly as is (`approved_requisition_required`).
- Perform the happy-path `apply_po_approval` call under the service role / superuser seam
  (claims cleared), which is the production shape. Assert `out_status = 'sent'`,
  `out_applied = true`, and that in_transit moved.
- Do NOT relax RLS on `inventory_levels` to make the test pass. The kernel contract stands.

### R4-F3 (TEST BUG) - stale cross-tenant expectation in schema.test.ts

"cannot create a document with another tenant's location or catalog rows" passes the OTHER
tenant as `p_tenant`; the B1 tenant gate now correctly raises
`requisition_creation_forbidden` before the location lookup. Behavior is stricter and
correct; the expectation is stale and cascades 8 more tests.

- Expect `requisition_creation_forbidden` for the cross-tenant call.
- Add an own-tenant + foreign-location (and/or foreign catalog rows) variant that still
  expects `active_location_not_found` / the relevant not-found errors, so those checks stay
  covered.

## VERIFICATION BAR

Same as round 3: state in the evidence what you expect from a clean `supabase db reset`
replay plus a fully green `npx vitest run` (all 140 files). If you cannot run them, say so
explicitly; Claude replays and runs them at the re-check. tsc, biome, craft, production
build as usual. The expectation for this round is ZERO red tests at the re-check.

## When done

Update `_agentic-os/projects/the-chain/CHECKPOINT_REVIEW.md` with a round-4 entry and a
dated `_reviews/` evidence file, then stop for the MG/Claude re-check. Prod stays `362137d`
until the re-review passes and MG gates the eight-migration merge.
