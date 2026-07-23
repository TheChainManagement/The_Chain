# Codex Fix List — W3 role-spine checkpoint round 1
*From Claude's independent review 2026-07-21. Full detail: `_reviews/2026-07-21_w3_checkpoint_claude_verdict.md`.*

## WORKSPACE PREFLIGHT (verify before touching anything)
- Repository: `TheChainManagement/The_Chain` (The Chain SaaS), local path
  `/Users/themoreapp/More Technologies/projects/the-chain`
- Branch: `codex/w3-role-spine` (exists locally and on origin; tip `c757483` carries the
  verdict + this fix list)
- Sanity files that MUST exist here: `_reviews/2026-07-21_w3_checkpoint_claude_verdict.md`
  and this file at `_codex/FIX_W3_CHECKPOINT_ROUND1.md`
- If ANY of the above does not match your current workspace (wrong repo, missing branch,
  missing files), STOP and report the mismatch. Do not adapt the work to another repo.

Work on `codex/w3-role-spine` (continue the branch). Do NOT merge to main, do NOT
apply migrations to any database, do NOT push main. New migrations get the next free
numbers after `20260720120000`. Keep the suite green and add the named tests called for
below. All prior standing rules apply (INVOKER + inline gate convention, RLS default-deny,
tenant pinning, no em dashes, tokens-only, zero balance writes in document RPCs).

## MUST FIX before this branch can merge

### B1 (BLOCKER) — bind requester identity to the caller
Confirmed exploit: a planner inserts a draft requisition with
`requested_by_user_id` = an owner who has `auto_approve_unlimited`, then calls
`submit_requisition`, and the system auto-approves with no human review (reproduced at
$99,900). Also enables author-as-B-then-approve-as-A.
- In `enforce_requisition_insert`: when `jwt_tenant_id()` is not null, require
  `new.requested_by_user_id = auth.uid()`.
- In `create_direct_requisition`: reject `p_actor is distinct from auth.uid()`, and verify
  the actor is a current member of `p_tenant`.
- Tests (named, mapping to this finding): (a) forged-requester insert is rejected;
  (b) author-as-another-then-self-approve is rejected; (c) the honest self-requester path
  still works end to end.

### B2 (HIGH) — close or document the direct-PO approval bypass
A planner appears able to create a `purchase_orders` row + lines and call
`apply_po_approval` to reach `sent`/`in_transit` without any approved requisition, making
the whole W3-5 authority spine advisory. Choose one and state which in the evidence:
- require an approved, current-version requisition for user-created POs (trigger when
  `jwt_tenant_id()` is not null), OR
- gate `apply_po_approval` on approval evidence, OR
- if PO-direct is intended, document explicitly where the spend control lives and why the
  requisition spine is not the gate.
- Test the chosen contract.

## SHOULD FIX in the same round (MED)

- **B3** — whitelist requisition status transitions in `enforce_requisition_update`; the
  current fall-through allows PATCH to `converted` from any state and `approved→draft` with
  stale decision evidence. Clear `decided_at`/`approval_reason`/`approval_policy_snapshot`
  on any return to draft.
- **B4** — role downgrade is stale-trusted on the service-role write paths
  (transfers/storeroom/reorder). Re-read role from `tenant_members` (add a
  `member_can_execute(p_tenant,p_user,capability)` definer primitive, or read the row) so a
  demoted member cannot keep writing until their token refreshes. Mirror the location fix.
- **B5** — revert `submit_requisition` and `decide_requisition` to `security invoker`
  (keep the inline checks as defense in depth), matching the project convention the prior
  review enforced on `execute_stock_transfer`.

## Nice-to-have (LOW — fix if cheap, else ticket)

Award-version-delete brick (compute next version from `max+1`), provisional-invite expiry +
role re-validation at activation, `activate_tenant_access` conflict should raise not
silently no-op, restrict `tenant_member_requisition_authority` select to self OR
owner/manager, `set_primary_location` `search_path=''`, transfer select OR-semantics for a
destination-only member.

## When done

Update `_agentic-os/projects/the-chain/CHECKPOINT_REVIEW.md` with the fix summary and write
per-fix evidence (probe results for B1/B2 especially) in a dated `_reviews/` file. Then stop
for the MG/Claude re-check. Prod stays `362137d` until the re-review passes and MG gates.
