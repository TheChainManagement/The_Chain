# Codex Fix List - W3 checkpoint fix round 3

*From Claude's independent re-check 2026-07-22. Full detail:
`_reviews/2026-07-22_w3_checkpoint_fix_round2_claude_verdict.md`.*

## WORKSPACE PREFLIGHT (verify before touching anything)

- Repository: `TheChainManagement/The_Chain`, local path
  `/Users/themoreapp/More Technologies/projects/the-chain`
- Branch: `codex/w3-role-spine`. Round-2 work and this file are committed on it.
- Sanity files that MUST exist:
  `_reviews/2026-07-22_w3_checkpoint_fix_round2_claude_verdict.md` and
  `supabase/migrations/20260722120000_w3_checkpoint_fix_round1.sql`.
- If ANY of the above does not match, STOP and report the mismatch.

Work on `codex/w3-role-spine`. Do NOT merge to main, do NOT apply migrations to any
database, do NOT push main. Good news first: R2-F1, R2-F2, and R2-F3 (Option A) were all
verified FIXED and stand as built. Exactly one blocker remains, it is round-1 code, and it
is a few lines. Amend `20260722120000_w3_checkpoint_fix_round1.sql` in place (still never
applied to prod or main). All standing rules apply.

## MUST FIX

### R3-F1 (BLOCKER) - decision-metadata tail guard fires on sanctioned transitions

In `enforce_requisition_update`, the tail guard (around lines 270-275 of the migration)

    elsif new.approved_by_user_id is distinct from old.approved_by_user_id
       or new.decided_at is distinct from old.decided_at then
      raise exception 'decision_metadata_guarded';

rejects the decision metadata that the status branches above it just validated for the
policy path (`v_policy_transition`: auto-approve sets `decided_at`) and the human path
(`v_human_transition`: decide sets `approved_by_user_id` + `decided_at`). Result: every
auto-approval and every human decision fails with `decision_metadata_guarded`. 27 tests in
5 files trace to this single root.

- Exempt the sanctioned paths on that guard, e.g. append
  `and not v_policy_transition and not v_human_transition`. Do NOT weaken the guard for
  ordinary PATCHes: with both GUCs off, direct decision-metadata edits must still raise.
- While there, confirm `rejection_note` cannot be mutated outside the human path or
  return-to-draft either; add the same exemption pattern if you harden it.
- Add or keep a probe that a plain authenticated PATCH setting `decided_at` or
  `approved_by_user_id` (no GUC) still raises `decision_metadata_guarded`.

## VERIFICATION BAR

Static checks alone do not count. The named bar for this round: after your change, state in
the evidence that you expect a clean `supabase db reset` replay plus a fully green
`npx vitest run` (all 140 files including `tests/procurement/approval-policy-rpc.test.ts`,
`tests/procurement/convert-rpc.test.ts`, `tests/procurement/schema.test.ts`,
`tests/inventory/kernel.test.ts`, `tests/reorder/generate.test.ts`). If you cannot run them,
say so explicitly; Claude will replay and run them at the re-check. tsc, biome, craft,
production build as usual.

## When done

Update `_agentic-os/projects/the-chain/CHECKPOINT_REVIEW.md` with a round-3 entry and a
dated `_reviews/` evidence file, then stop for the MG/Claude re-check. Prod stays `362137d`
until the re-review passes and MG gates the eight-migration merge.
