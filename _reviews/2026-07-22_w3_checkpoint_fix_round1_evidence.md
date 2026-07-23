# W3 checkpoint fix round 1 evidence - 2026-07-22

Branch: `codex/w3-role-spine`

Production baseline: `362137d`, unchanged. No migration was applied to any database and nothing was
merged or pushed. The fix is isolated in
`supabase/migrations/20260722120000_w3_checkpoint_fix_round1.sql`, the next free number after
`20260720120000`.

## B1 - requester identity bound to the caller

`enforce_requisition_insert()` rejects an authenticated row unless
`requested_by_user_id = auth.uid()`. `create_direct_requisition()` independently rejects a distinct
actor, a tenant mismatch, and a missing current membership.

Named real-DB probes added in `tests/procurement/approval-policy-rpc.test.ts`:

- `forged-requester insert is rejected`: a planner names the unlimited owner on a $99,900 direct
  insert. Expected: `requester_must_be_caller` and no row.
- `author-as-another-then-self-approve is rejected`: a manager authors as the planner before trying
  to approve as themselves. Expected: `requester_must_be_caller` at insert.
- `honest self-requester path still works end to end`: a planner creates as themselves, submits
  under approval-required policy, and a different manager approves.

These probes are committed for the MG/Claude migration replay. They were not executed in this round
because the run prompt explicitly forbids applying migrations to any database. Running them against
the pre-fix local schema would not test this migration.

## B2 - chosen contract: apply requires approval evidence

Chosen option: gate `apply_po_approval()` on approval evidence. Every caller, including the
application service role, must present a PO linked to a current requisition whose state is
`converted`, whose `decided_at` is set, and whose decision is either a human approver or a complete
system auto-approval reason plus policy snapshot.

`approveAndPushPurchaseOrder()` checks the same evidence before adapter creation or QBO I/O. This
prevents an unapproved order from being externally placed before the transactional RPC rejects it.

The named real-DB contract probe `rejects a direct PO and accepts one converted from an approved
current requisition` has two controls:

1. A costed draft PO with no requisition fails with `approved_requisition_required` before any
   in-transit write.
2. An honest request is submitted, approved by a different manager, converted, and then its linked
   PO approval succeeds.

The purchase-UoM kernel fixture now carries explicit converted-requisition evidence so its approval
test continues to exercise inventory math under the new spend-control precondition.

## B3 - lifecycle whitelist

The update trigger rejects every unlisted status edge. `approved -> converted` requires the
transaction-local gate set by `convert_requisition_to_po()`. A rejected request may return to draft,
and that edge clears approver, decision time, rejection note, approval reason, and policy snapshot.
Coverage rejects a direct draft-to-converted patch and verifies all evidence is null after reopen.

## B4 - live role checks

`member_can_execute(tenant,user,capability)` reads `tenant_members`, ignores JWT role claims, uses
SECURITY DEFINER with an empty search path, and is executable only by the service role. Transfer,
storeroom, cycle-count, and reorder actions use it. Inventory-operation and transfer-event triggers
repeat the current-role check at the database mutation seam.

Action probes pass, including `rejects a stale warehouse claim after a live
downgrade`. A real-DB transfer probe demotes the actor to viewer and expects
`inventory_operation_forbidden` with no transfer event.

## B5 - invoker convention

Submission and decision are restored to SECURITY INVOKER. Inline current-membership, tenant,
role, location, requester, ceiling, and no-self-approval checks remain. A catalog probe asserts
`prosecdef = false` for both functions.

## Low-cost cleanup completed

- Requisition-authority SELECT is self or owner/manager only.
- `set_primary_location(uuid,uuid)` now has `search_path = ''`.
- Transfer-event SELECT uses source OR destination access.

## Deferred LOW tickets

- Award version after deletion: compute `max(award_version) + 1` under the RFQ lock.
- Provision activation: expire every pending invite form consistently, revalidate the proposed role
  at activation, and raise on membership conflict instead of silently accepting `ON CONFLICT DO
  NOTHING`.
- Replace remaining lifecycle GUCs with per-row one-shot tokens in a later hardening pass.

## Mechanical results

- `npm run typecheck`: PASS.
- `npm run lint`: PASS, 366 source files.
- `npm run check:craft`: PASS.
- Targeted transfer, storeroom, reorder, and PO approval action suite: PASS, 4 files / 43 tests.
- PO approval core integration suite: PASS, 1 file / 6 tests, including rejection before external
  push. This app-layer check is testable on the existing schema and required no migration apply.
- Existing-schema suite excluding only the two files whose new assertions require this unapplied
  migration: PASS, 138 files / 970 tests.
- Database migration replay and new real-DB probes: NOT RUN by instruction. No database was mutated.
- Production build: PASS, 59 static/dynamic routes generated.

## Re-check request

MG/Claude should replay through `20260722120000`, run the named B1 and B2 probes first, confirm zero
balance writes during requisition submission, decision, and conversion, then run the full suite and
schema advisor. Production stays at `362137d` until that gate passes.
