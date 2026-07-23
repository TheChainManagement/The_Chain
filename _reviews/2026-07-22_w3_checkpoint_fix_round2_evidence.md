# W3 checkpoint fix round 2 evidence

> VERIFICATION LIMIT: NOT VERIFIED AGAINST A REPLAYED SCHEMA. The task explicitly forbids applying
> migrations to any database, so this run did not execute `supabase db reset` and did not run the
> migration-dependent real-database tests against the amended schema. The MG/Claude re-check must
> perform that verification before merge. No database verification is claimed here.

Date: 2026-07-22  
Branch: `codex/w3-role-spine`  
Production remains: `362137d`

## Migration choice

`supabase/migrations/20260722120000_w3_checkpoint_fix_round1.sql` was amended in place. The file has
not been applied to production or merged to main, and the round-2 prompt explicitly permits this
choice. No new migration number was allocated.

## R2-F1: authenticated location check

`submit_requisition()` remains SECURITY INVOKER. Its call to the service-role-only
`member_can_access_location()` was replaced with `can_access_location(v_req.location_id)`. The
actor is already pinned to `auth.uid()` and the JWT tenant, so the caller-scoped helper preserves
the intended location semantics without requiring a forbidden function privilege.

Coverage remains in `tests/procurement/approval-policy-rpc.test.ts`, including authenticated submit
paths and the function security catalog assertion. Real-database execution is pending schema
replay.

## R2-F2: locked authority helper

Added `lock_member_requisition_authority(p_tenant, p_user)` with these properties:

- SECURITY DEFINER, volatile, and `search_path = ''`.
- Requires a non-null authenticated actor and exact `p_tenant = jwt_tenant_id()` pinning.
- Requires the actor to be a current tenant member.
- Permits target reads only for self or a current owner/manager.
- Reads current role and requester/approver limits while taking `FOR SHARE` locks on both
  `tenant_members` and `tenant_member_requisition_authority`.
- Grants EXECUTE only to `authenticated`; `service_role`, `anon`, and PUBLIC remain revoked.

Both SECURITY INVOKER RPCs consume this helper. Submit locks the actor and requester authority;
decide locks the actor and approver authority. Inline tenant, role, location, lifecycle, limit, and
self-approval checks remain in the RPCs.

Named coverage was added to `tests/procurement/approval-policy-rpc.test.ts` for self access,
cross-member rejection, helper definer status, authenticated EXECUTE, service-role denial, and the
continued INVOKER status of submit and decide. Real-database execution is pending schema replay.

## R2-F3: Option A reorder spend spine

MG confirmed Option A. The old direct reorder-to-PO RPC is removed and replaced by
`convert_recommendations_to_requisition()`:

1. The authenticated converter is pinned to `auth.uid()`, the JWT tenant, a current purchasing
   role, and an authorized location.
2. Open same-supplier, same-location recommendations are locked and costed in purchase UoM.
3. A requisition and lines are created with the converter as requester.
4. The recommendations are linked to that requisition and marked converted in the same transaction.
5. `submit_requisition()` evaluates the current W3-5 requester policy.
6. Only an auto-approved requisition is converted to a linked draft PO. Above-limit and
   approval-required requests return a submitted requisition and no PO.

There is no B2 exemption. `apply_po_approval()` still requires the linked current converted
requisition and immutable human or system approval evidence.

End-to-end real-database coverage was added in `tests/reorder/generate.test.ts` for:

- default policy producing a submitted requisition and no PO;
- recommendation linkage and double-conversion rejection;
- an authorized member with an exact requester limit receiving automatic approval;
- creation of a requisition-linked PO; and
- successful PO approval through the existing B2 evidence gate.

`tests/inventory/kernel.test.ts` now exercises reorder conversion through the new RPC and retains
purchase-UoM assertions. Action and queue tests cover both PO routing and pending-requisition
routing.

## Checks completed without schema replay

- `npm run typecheck`: PASS.
- `npm run lint`: PASS, 366 files.
- `npm run check:craft`: PASS.
- Targeted queue and action tests: PASS, 3 files and 14 tests.
- Broad old-schema-compatible run initially found three stale assertions in the historical reorder
  queue review artifact. Those assertions and its action mock were updated to the new submit
  contract. The repeated run passed 134 files and 932 tests. Six migration-dependent files were
  excluded because the amended migration was not applied.
- `npm run build`: PASS, including TypeScript and all 59 static-page generation steps.
- `git diff --check`: PASS.

## Required MG/Claude replay gate

Before merge, run a clean local replay and the full gate against the amended schema:

```text
supabase db reset
npx vitest run
npm run typecheck
npm run lint
npm run check:craft
npm run build
```

The re-check must include at least `tests/procurement/approval-policy-rpc.test.ts`,
`tests/procurement/convert-rpc.test.ts`, `tests/procurement/schema.test.ts`,
`tests/reorder/generate.test.ts`, `tests/inventory/kernel.test.ts`, and
`tests/transfers/contract.test.ts`. Merge and production gates remain closed until that replay is
green.
