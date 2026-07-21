# W3 role-spine checkpoint — Claude independent verdict (2026-07-21)

Branch `codex/w3-role-spine` (tip `ffb8589`), W3-0 through W3-5, 6 commits, 85 files,
~8k insertions. Reviewed against `docs/WAVE3_W3-0_ROLE_SPINE_DESIGN.md`, MASTER rules,
and the W2-3/W2-4 bug classes. Prod remains `362137d` — untouched.

## VERDICT: NO-GO on merge. One confirmed BLOCKER + one HIGH. Branch goes back to Codex.

The spine is genuinely well-built: guarded RPCs self-defend (DB-role re-read, row locks,
tenant pinning, ACL revokes, lifecycle GUC gates), tenant-switch/provisional-claim/
location-scope all hold under adversarial probing, and the mechanical gates are green
(tsc, biome 366, production build 59 pages, clean migration replay through
`20260720120000`, vitest 140 files / 980 tests). But the W3-5 approval feature has a
hole that inverts its entire purpose.

## BLOCKER — B1: requester identity is forgeable → approval bypass (CONFIRMED, reproduced)

`requested_by_user_id` is never bound to `auth.uid()`. The `requisitions_insert` RLS
policy checks only tenant + location + role; `enforce_requisition_insert`
(`20260720120000:170`) checks only status/version; and `create_direct_requisition`
(`20260715120000:11,50`) writes a caller-supplied `p_actor` verbatim. `submit_requisition`
then evaluates the **named requester's** authority.

**Reproduced on the local stack (throwaway fixture):** a `planner` on the default
approval-required policy directly inserted a draft requisition with
`requested_by_user_id` = the owner (who holds `auto_approve_unlimited`), then called
`submit_requisition`. Result: `status=approved`, `approval_reason=unlimited_requester_authority`,
`approved_by_user_id=null` (system decision), evaluated total **$99,900**, zero human
review. A secondary variant lets manager A author "as B" then approve it themselves
(the no-self-approval check compares approver to the forged requester, so A≠B passes).

**Fix:** in `enforce_requisition_insert`, when `jwt_tenant_id()` is not null require
`new.requested_by_user_id = auth.uid()`; in `create_direct_requisition` reject
`p_actor <> auth.uid()` and verify the actor is a member of `p_tenant`. Add a named test
for both the forged-insert and author-then-self-approve variants.

## HIGH — B2: the approval spine is advisory; direct PO path skips it (needs Codex confirm)

Flagged by migration review, not independently reproduced here. `purchase_orders`
insert/update policies admit planner+location, and `apply_po_approval`
(`20260713120000:448`) has no approval-evidence gate — so a PO can be created and pushed
to `sent`/`in_transit` without ever passing through an approved requisition. If accurate,
the whole W3-5 requester-mode/approver-ceiling machinery governs only the requisition
document and not actual spend. Codex should either require an approved current-version
requisition for user-created POs, or gate `apply_po_approval` on approval evidence, or
explicitly document that PO-direct is intended and where the spend control lives.

## MED — worth fixing in the same round

- **B3 — unguarded requisition status transitions** (`20260720120000:225-253`): the trigger
  gates submitted/approved/rejected but falls through to `return new` on anything else. A
  planner can PATCH `status='converted'` from any state, or `approved→draft` (reopens line
  editing while leaving stale `decided_at`/`approval_reason`). Whitelist transitions; clear
  decision evidence on any return to draft.
- **B4 — role downgrade not enforced on service-role write paths** (transfers/storeroom/
  reorder actions + their invoker RPCs): these gate on the JWT `tenant_role` claim, which is
  stale for up to the token TTL after an owner demotes a member. W3 newly makes demotion a
  first-class flow, so a just-demoted user can still move/adjust stock until the token
  refreshes. Location dimension is live-checked and safe; only role is claim-trusted. Re-read
  role from `tenant_members` on those paths (mirror the location fix).
- **B5 — submit/decide flipped to SECURITY DEFINER** (`20260720120000:300,413`) against the
  project's INVOKER-plus-app-gate convention (the same call the prior review forced on
  `execute_stock_transfer`). Inline checks are present and tenant-pinned, so not exploitable
  today, but it removes the RLS backstop. Revert to invoker, keep the inline checks.

## LOW — track, not blocking

- Deleting the current award version bricks the RFQ (version recompute collides on the
  unique index) — compute next version from `max(award_version)+1`.
- Provisional invites to existing users never expire and re-apply a stale role snapshot.
- `activate_tenant_access` `on conflict do nothing` silently drops the role on a claim race.
- `tenant_member_requisition_authority` select policy exposes every member's limits to any
  member (recon for B1) — restrict to self OR owner/manager.
- `set_primary_location` uses `search_path=public` not `''` (convention drift).
- Transfer select needs both endpoints (destination-only member can't see inbound).
- GUC-based lifecycle gates are safe today but fragile; prefer per-row one-shot tokens.

## What passed hard verification (so Codex keeps it)

- Tenant switch: no prior-tenant leak, fails closed to signout, real-membership required.
- Provisional claim: keyed to auth_user_id, `FOR UPDATE` lock, citext email — no wrong-user claim.
- Location scope: `member_can_access_location` reads membership tables not the JWT; RLS
  rewritten across ~22 tables; URL-tamper denied. Verified live in the prior W3-3 walkthrough.
- W3-4 `/plan` compute formula faithful to design §9; `set_primary_location` atomicity real.
- W3-5 policy math correct where identity is honest: default→queue, within-limit→auto,
  one-cent-over→queue, approver-ceiling→`approval_over_authority`, self-approval→blocked,
  cross-tenant authority set→`authority_forbidden`, direct table writes→RLS/grant denied.
  All eight of those probes passed; B1 is specifically the identity-binding gap.

## Migration application

NONE applied. Prod stays `362137d`. When B1/B2 (min.) are fixed and re-reviewed, the merge
gate applies SEVEN migrations in order (w3_0 `20260717120000` → w3_1 `20260717133000` →
w3_2 `20260718120000` → w3_2_hardening `20260718123000` → w3_3 `20260718130000` → w3_4
`20260718140000` → w3_5 `20260720120000`), which includes the W3-4 `set_primary_location`
W2-4 race fix, then re-probe schema + advisor. MG gates the merge; no push to main here.
