# Claude independent re-check: W3 checkpoint fix round 2 - 2026-07-22

Scope reviewed: the uncommitted round-2 working tree on `codex/w3-role-spine` (local tip
`d07cb5d`). The fix migration `20260722120000_w3_checkpoint_fix_round1.sql` was amended in
place (never applied to prod or main, so legitimate), reorder conversion was rebuilt for
MG's Option A, and the reorder UI/actions/tests were updated. Codex again could not apply
migrations, so this re-check replayed the schema and ran the real-DB suite.

## VERDICT: NO-GO (round 3) - one blocker left, and it is small

Round 2 fixed everything it was asked to fix. The suite is still red only because the
round-1 `enforce_requisition_update` trigger carries a latent guard bug that the round-1
permission failures had been masking: now that submit/decide actually execute, the tail
guard rejects the very decision metadata the status branches just validated.

## Round-2 asks: all three CONFIRMED FIXED

- **R2-F1 FIXED.** `submit_requisition` now uses caller-pinned `can_access_location(uuid)`.
  No permission-denied-on-function failures anywhere in the suite.
- **R2-F2 FIXED.** New `lock_member_requisition_authority(p_tenant, p_user)` definer helper:
  empty search_path, JWT-tenant pinning, self-or-owner/manager visibility, owns the
  `for share of m, a` lock; submit/decide consume it and stay INVOKER with inline gates.
  Catalog probe confirms `prosecdef = false` on both RPCs. No permission-denied-on-table
  failures remain.
- **R2-F3 (Option A) IMPLEMENTED CORRECTLY.** `convert_recommendations_to_po` is dropped;
  `convert_recommendations_to_requisition` (INVOKER, authenticated-only) converts a
  same-supplier/same-location open set into a requisition with the converter as requester,
  submits it through the W3-5 policy spine in the same transaction, and only fans out to a
  PO when auto-approved; otherwise the request queues with no PO. `reorder_recommendations`
  gains a tenant-scoped `requisition_id` FK (set-null on delete). App layer runs on the
  user's client (RLS + invoker semantics), and the queue UI routes to the PO or the queued
  requisition and relabels the CTA "Submit purchase request". The B2 gate keeps no reorder
  exemption. This is exactly the one-spend-spine shape MG picked.

## Remaining blocker

### R3-F1 (BLOCKER) - decision-metadata tail guard rejects legitimate GUC-gated transitions

`enforce_requisition_update` (migration lines ~270-275): after the status-transition
branches validate `approved_by_user_id` / `decided_at` for the policy (`v_policy_transition`)
and human (`v_human_transition`) paths, the unconditional tail guard

    elsif new.approved_by_user_id is distinct from old.approved_by_user_id
       or new.decided_at is distinct from old.decided_at then
      raise exception 'decision_metadata_guarded';

fires anyway: auto-approve sets `decided_at` null -> now(), human decide sets both. Every
`submit_requisition` auto-approval and every `decide_requisition` call fails with
`decision_metadata_guarded`. This is round-1 code; the round-1 permission blockers died
earlier in the same statements, so the guard was never reached until now.

Fix: exempt the sanctioned paths, e.g.
`and not v_policy_transition and not v_human_transition` on that guard (the status branches
already validate the metadata shape for those paths).

### Failure inventory

27 failing tests in 5 files (`approval-policy-rpc`, `convert-rpc`, `schema`,
`kernel`, `reorder/generate`). Error tally shows exactly one distinct root:
`decision_metadata_guarded`; everything else is aborted-transaction cascade. No second
mechanical root found.

## What else was verified

- Clean `supabase db reset` replay through the amended `20260722120000` (including the
  composite FK with column-targeted `on delete set null`).
- tsc PASS, biome PASS (366 files), craft PASS.
- 965/992 tests green; the 27 red all trace to R3-F1.
- Zero-balance-writes invariant intact: `convert_recommendations_to_requisition` writes
  documents and recommendation status only; PO fan-out reuses `convert_requisition_to_po`;
  in-transit still moves only via `apply_po_approval`.
- Codex's evidence honestly states it could not verify against a replayed schema.

## Gate state

Prod untouched at `362137d`. main untouched. Local replay only. Merge gate stays closed.
Round-3 fix prompt: `_codex/FIX_W3_CHECKPOINT_ROUND3.md`. After R3-F1, the expectation is a
fully green 140+/992 suite and this loop closes to the MG production gate (EIGHT migrations:
w3_0 20260717120000 -> w3_1 -> w3_2 -> w3_2_hardening -> w3_3 -> w3_4 -> w3_5 20260720120000
-> fix 20260722120000).
