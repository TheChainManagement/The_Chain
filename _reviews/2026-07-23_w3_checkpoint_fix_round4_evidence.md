# W3 checkpoint fix round 4 evidence

> VERIFICATION LIMIT: THE AMENDED MIGRATION WAS NOT APPLIED. The task explicitly prohibits
> applying migrations to any database, so the new UoM behavior was not executed against a
> round-4 replayed schema. Claude must perform the clean replay and full 140-file run at re-check.
> No round-4 schema verification is claimed here.

Date: 2026-07-23  
Branch: `codex/w3-role-spine`  
Production remains: `362137d`

## Preflight

- Repository path: `/Users/themoreapp/More Technologies/projects/the-chain`.
- Origin: `https://github.com/TheChainManagement/The_Chain.git`.
- Branch: `codex/w3-role-spine`.
- Starting worktree: clean.
- Round-3 work and round-4 prompt: committed.
- Required round-3 verdict and `20260722120000_w3_checkpoint_fix_round1.sql`: present.

## R4-F1: consistent reorder UoM snapshot pair

Both passes in `convert_recommendations_to_requisition()` now derive the same normalized values:

- blank or null `product_suppliers.purchase_uom` becomes null;
- the snapshot factor is null when the normalized UoM is null;
- a non-null UoM keeps its configured factor, defaulting to 1 only when the configured factor is
  null; and
- ordered quantity and total arithmetic use `coalesce(v_factor, 1)`.

The inserted `requisition_lines` snapshot is therefore either null/null or UoM/factor and cannot
produce the invalid null/1 pair. This change affects document conversion only and does not write
inventory balances.

The real-database reorder test now explicitly starts from a supplier link with null UoM and null
factor, converts its recommendation, and asserts:

- conversion succeeds under the default approval policy;
- the requisition line stores null UoM and null factor;
- quantity remains 100 stock units;
- unit cost remains 5;
- requisition total is 500; and
- no PO is created while approval is required.

This probe is pending the clean round-4 schema replay.

## R4-F2: production-shaped B2 happy path

The B2 probe retains its authenticated planner call against a direct PO and still expects
`approved_requisition_required`. After conversion from an approved current requisition, the valid
`apply_po_approval()` call now runs after `asSuperuser()` clears the member role and claims. This
matches the production service-role seam without relaxing `inventory_levels` RLS. The test asserts
`out_status = 'sent'`, `out_applied = true`, and an exact one-unit increase in `in_transit`.

Result against Claude's existing round-3 replay: PASS.

## R4-F3: strict tenant gate and retained foreign-row coverage

The cross-tenant `create_direct_requisition()` call now expects
`requisition_creation_forbidden`, matching the B1 tenant pin. A separate call uses the caller's
own tenant with a foreign location and own-tenant catalog rows; it still expects
`active_location_not_found`.

Result against Claude's existing round-3 replay: PASS.

## Verification completed

- `npm run typecheck`: PASS.
- `npm run lint`: PASS, 366 files.
- `npm run check:craft`: PASS.
- Production build: PASS, including TypeScript and all 59 static pages.
- Corrected database files: PASS, 2 files and 26 tests.
- Round-3-schema suite excluding only `tests/reorder/generate.test.ts`: PASS, 139 files and 986
  tests.
- `git diff --check`: PASS.

## Expected MG/Claude replay result

After a clean `supabase db reset`, the expectation is zero red tests from a fully green
`npx vitest run` across all 140 files, including:

- `tests/procurement/approval-policy-rpc.test.ts`
- `tests/procurement/convert-rpc.test.ts`
- `tests/procurement/schema.test.ts`
- `tests/inventory/kernel.test.ts`
- `tests/reorder/generate.test.ts`

The replay should prove the UoM-less reorder path succeeds while every previously verified B1,
B2, RLS, authority, lifecycle, and zero-balance contract remains intact.

Required re-check commands:

```text
supabase db reset
npx vitest run
npm run typecheck
npm run lint
npm run check:craft
npm run build
```

No migration, merge, push, production change, or RLS relaxation was performed in this run.
