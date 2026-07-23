# Claude independent re-check: W3 checkpoint fix round 1 - 2026-07-22

Scope reviewed: the uncommitted fix-round working tree on `codex/w3-role-spine` (local tip
`c757483`, in sync with origin). One new migration
`supabase/migrations/20260722120000_w3_checkpoint_fix_round1.sql`, app-layer changes in
transfers/storeroom/cycle-counts/reorder actions, `location-access.ts`, `approve-core.ts`,
plus new and updated tests. Codex's own evidence
(`_reviews/2026-07-22_w3_checkpoint_fix_round1_evidence.md`) states the real-DB probes were
NOT run because the run prompt forbade applying migrations. This re-check ran them.

## VERDICT: NO-GO (round 2)

The B1/B2/B3/B4 designs are correct and the diff is disciplined, but the B5 revert shipped a
privilege regression that breaks requisition submission and decision for every authenticated
user, and the B2 gate silently dead-ends the reorder-to-PO flow. The suite is RED once the
migration is actually applied.

## What passed (verified independently, not from the report)

- Clean `supabase db reset` replay through `20260722120000`.
- `npm run typecheck` PASS, `biome check src` PASS (366 files), craft guard PASS.
- 137/140 test files, 965/989 tests green.
- B1 requester binding: design correct. `enforce_requisition_insert` requires
  `requested_by_user_id = auth.uid()` when a tenant claim is present;
  `create_direct_requisition` independently rejects a distinct actor, tenant mismatch, and
  non-membership. The named forged-requester probes are present and correctly shaped.
- B2 contract choice (gate `apply_po_approval` on approval evidence, all callers including
  service role) is the right one, and the app layer mirrors it in
  `approveAndPushPurchaseOrder` before any external I/O.
- B3 lifecycle whitelist and evidence-clearing on return-to-draft: correct.
- B4 `member_can_execute` live-role primitive + event-seam triggers
  (`inventory_op_events_current_role`, `stock_transfer_events_current_role`): correct,
  definer, empty search_path, service-role-only execute. Transfer probe demoting the actor
  live passes.
- Low-sev cleanups (authority SELECT self-or-owner/manager, `set_primary_location`
  search_path, transfer-event OR-semantics) all present.
- Zero-balance-writes invariant: intact. The only balance writer added or touched is the
  in-transit upsert already inside `apply_po_approval` (pre-existing kernel surface).
- Codex honestly reported which gates it could not run. The report's claims about what it
  DID run all reproduced.

## Findings

### F1 (BLOCKER) - B5 invoker revert breaks submit_requisition for every authenticated user

`submit_requisition` (W3-5) calls `member_can_access_location(p_tenant, v_actor,
v_req.location_id)`. W3-3 revoked EXECUTE on that function from everyone except
`service_role`. Under SECURITY DEFINER that was fine; after `alter function ... security
invoker` the caller is `authenticated` and the call raises
`permission denied for function member_can_access_location`. Reproduced: the named
"honest self-requester path still works end to end" probe FAILS on exactly this.
Every authenticated submission path is dead.

Fix direction: inside `submit_requisition`, use the caller-pinned
`public.can_access_location(v_req.location_id)` (already granted to `authenticated`, pins
tenant and user from the JWT; `v_actor` is `auth.uid()` here so the semantics are
identical). Keep `member_can_access_location` service-role-only.

### F2 (BLOCKER) - row-lock clauses require UPDATE privilege the invoker does not have

`submit_requisition` and `decide_requisition` both lock policy state with
`for share of m, a` on `tenant_members` + `tenant_member_requisition_authority`. Explicit
row-locking requires UPDATE privilege; `authenticated` has SELECT only on both tables (by
design, W3-0/W3-5). Under INVOKER the statement raises
`permission denied for table tenant_member_requisition_authority`. Reproduced in the
convert-rpc suite (`expected self_approval_forbidden but got permission denied`).

Fix direction: move the membership+authority read-and-lock into one narrow SECURITY DEFINER
helper that pins `p_tenant = jwt_tenant_id()` and takes FOR SHARE internally, grant execute
to `authenticated`, and have both RPCs consume it. That keeps B5's invoker convention AND
the race protection. (Dropping the lock is the fallback; if chosen, document why the
demote-during-submit race is acceptable.)

### F3 (HIGH, design gap for MG) - reorder-converted POs are now permanently unapprovable

`convertSelectedToPo` -> `convertRecommendationsToPo` creates POs with no `requisition_id`
(unchanged this round). The new B2 gate (DB and app layer) requires converted-requisition
evidence for EVERY PO, so the entire reorder engine output can never be approved or pushed.
Nothing in the evidence file acknowledges this; the approve-core test fixture was adapted to
carry requisition evidence rather than confronting the path. This needs an MG product
decision, then a Codex implementation:

- Option A (recommended, one spend spine): reorder conversion creates a requisition through
  the W3-5 policy spine (auto-approved within the converter's authority, queued above it),
  and the PO hangs off that requisition.
- Option B: system-recommended POs get a documented, tested exemption with its own spend
  control. Must be explicit about where the control lives.

### Failure inventory

24 failing tests in 3 files (`tests/procurement/approval-policy-rpc.test.ts`,
`tests/procurement/convert-rpc.test.ts`, `tests/procurement/schema.test.ts`) all collapse
to F1 and F2 (most as aborted-transaction cascades). No third mechanical root was found.

## Gate state

Prod untouched at `362137d`. main untouched. NOTHING applied to any remote database; local
replay only. The seven-migration merge gate (w3_0 -> w3_5 + this fix migration = EIGHT
files once green) stays closed until round 2 passes re-review and MG gates.

Round-2 fix prompt for Codex: `_codex/FIX_W3_CHECKPOINT_ROUND2.md`.
