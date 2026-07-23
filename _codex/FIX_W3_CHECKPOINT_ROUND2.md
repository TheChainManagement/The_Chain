# Codex Fix List - W3 checkpoint fix round 2

*From Claude's independent re-check 2026-07-22. Full detail:
`_reviews/2026-07-22_w3_checkpoint_fix_round1_claude_verdict.md`.*

## WORKSPACE PREFLIGHT (verify before touching anything)

- Repository: `TheChainManagement/The_Chain` (The Chain SaaS), local path
  `/Users/themoreapp/More Technologies/projects/the-chain`
- Branch: `codex/w3-role-spine`. The round-1 fix work and this file are committed on it.
- Sanity files that MUST exist:
  `_reviews/2026-07-22_w3_checkpoint_fix_round1_claude_verdict.md`,
  `supabase/migrations/20260722120000_w3_checkpoint_fix_round1.sql`, and this file.
- If ANY of the above does not match, STOP and report the mismatch. Do not adapt the work
  to another repo.

Work on `codex/w3-role-spine`. Do NOT merge to main, do NOT apply migrations to any
database, do NOT push main. Round-1 context: your B1/B2/B3/B4 designs were verified correct
and stand. The two blockers below are both fallout from the B5 SECURITY INVOKER revert and
only surfaced when the migration was actually replayed and the real-DB probes run. Amend
`20260722120000_w3_checkpoint_fix_round1.sql` in place (it has never been applied to prod
or committed to main; the local db resets on replay) OR add the next free migration number,
your call - state which in the evidence. All standing rules apply (INVOKER + inline gate
convention, RLS default-deny, tenant pinning, zero balance writes in document RPCs, no em
dashes, tokens-only).

## MUST FIX

### R2-F1 (BLOCKER) - submit_requisition calls a function authenticated cannot execute

`submit_requisition` calls `member_can_access_location(p_tenant, v_actor, ...)`, which is
EXECUTE-granted to `service_role` only (W3-3). After the invoker revert every authenticated
submission raises `permission denied for function member_can_access_location`.

- Replace the call with the caller-pinned `public.can_access_location(v_req.location_id)`
  (already granted to `authenticated`; `v_actor` is `auth.uid()` at that point so semantics
  are identical). Keep `member_can_access_location` service-role-only.

### R2-F2 (BLOCKER) - FOR SHARE locks need UPDATE privilege the invoker lacks

`submit_requisition` and `decide_requisition` lock `tenant_members` +
`tenant_member_requisition_authority` with `for share of m, a`. Explicit row locks require
UPDATE privilege; `authenticated` has SELECT only, so both RPCs raise
`permission denied for table tenant_member_requisition_authority`.

- Preferred: one narrow SECURITY DEFINER helper (empty search_path) that pins
  `p_tenant = public.jwt_tenant_id()`, performs the membership+authority read WITH the
  FOR SHARE lock internally, and returns role/mode/limits. Grant execute to
  `authenticated`. Both RPCs consume it. This keeps the invoker convention and the
  demote-during-submit race protection.
- Fallback: drop the locks and document in the evidence why the race is acceptable. Only if
  the helper genuinely does not work.

### R2-F3 (HIGH) - reorder-converted POs are permanently unapprovable under the B2 gate

`convertRecommendationsToPo` creates POs with no `requisition_id`; the B2 gate (DB + app
layer) now rejects their approval forever. MG DECISION REQUIRED before you build - the fix
prompt will be updated with his choice, or he will tell you directly:

- Option A (Claude-recommended): reorder conversion creates a requisition through the W3-5
  policy spine (auto-approve within the converting member's authority, queue above it), PO
  hangs off that requisition. One spend spine for everything.
- Option B: documented, tested exemption for system-recommended POs with an explicit
  statement of where their spend control lives.

Test the chosen contract end to end: recommendations -> convert -> approve path works for
an authorized member and respects the spend policy.

## VERIFICATION BAR for this round

The round-1 gap was unverified DB behavior. This round: after your changes, a clean
`supabase db reset` replay plus the FULL suite (`npx vitest run`, all 140+ files, including
`tests/procurement/approval-policy-rpc.test.ts`, `tests/procurement/convert-rpc.test.ts`,
`tests/procurement/schema.test.ts`) must be green against the replayed local schema. If the
environment truly cannot run them, say so explicitly at the top of the evidence and do not
claim the fix is verified. tsc, biome, craft, production build as usual.

## When done

Update `_agentic-os/projects/the-chain/CHECKPOINT_REVIEW.md` with a round-2 entry and write
per-fix evidence in a dated `_reviews/` file. Then stop for the MG/Claude re-check. Prod
stays `362137d` until the re-review passes and MG gates.
