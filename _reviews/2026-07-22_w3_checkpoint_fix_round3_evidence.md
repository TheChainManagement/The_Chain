# W3 checkpoint fix round 3 evidence

> VERIFICATION LIMIT: NOT VERIFIED AGAINST THE AMENDED SCHEMA. The task explicitly prohibits
> applying migrations to any database, so this run did not execute `supabase db reset` and could
> not execute the migration-dependent probes against the round-3 trigger definition. Claude must
> replay and run the full suite during the re-check. No amended-schema verification is claimed.

Date: 2026-07-22  
Branch: `codex/w3-role-spine`  
Production remains: `362137d`

## Preflight

- Repository path: `/Users/themoreapp/More Technologies/projects/the-chain`.
- Origin: `https://github.com/TheChainManagement/The_Chain.git`.
- Branch: `codex/w3-role-spine`.
- Starting worktree: clean.
- Required round-2 verdict and `20260722120000_w3_checkpoint_fix_round1.sql`: present.

## R3-F1 fix

The final decision-metadata guard in `enforce_requisition_update()` now raises only when one of
these fields changes outside the already validated policy or human transition paths:

- `approved_by_user_id`
- `decided_at`
- `rejection_note`

The guard is expressed as one parenthesized field-difference check followed by both exemptions:
`not v_policy_transition and not v_human_transition`. This permits metadata written by
`submit_requisition()` and `decide_requisition()` only after their status branches validate the
transition and metadata shape. It does not exempt ordinary PATCHes because both transaction GUCs
are off for those writes.

The existing `v_returning_to_draft` branch remains first and explicitly clears approver, decision
timestamp, rejection note, reason, and policy snapshot. No other path was weakened.

## Regression coverage

`tests/procurement/approval-policy-rpc.test.ts` now includes plain authenticated PATCH probes that
independently attempt to set:

- `decided_at`
- `approved_by_user_id`
- `rejection_note`

Each probe expects `decision_metadata_guarded`, uses its own savepoint, and runs without either
sanctioning GUC. Existing tests cover exact-limit automatic approval, unlimited automatic
approval, human approval, human rejection, and return-to-draft evidence clearing.

## Verification completed

- `npm run typecheck`: PASS.
- `npm run lint`: PASS, 366 files.
- `npm run check:craft`: PASS.
- Production build: PASS, including TypeScript and 59 static pages.
- Migration-independent Vitest run: PASS, 134 files and 932 tests.
- `git diff --check`: PASS.

The migration-dependent files were excluded from the local Vitest run because the amended
migration was not applied. This includes the named procurement, inventory, reorder, and transfer
database contracts.

## Expected MG/Claude replay result

After a clean `supabase db reset`, the expectation is a fully green `npx vitest run` across all
140 files, including:

- `tests/procurement/approval-policy-rpc.test.ts`
- `tests/procurement/convert-rpc.test.ts`
- `tests/procurement/schema.test.ts`
- `tests/inventory/kernel.test.ts`
- `tests/reorder/generate.test.ts`

The replay should prove that automatic approvals can set `decided_at`, human decisions can set
the approver and timestamp, rejections can set their note, and direct authenticated metadata
PATCHes still raise `decision_metadata_guarded`.

Required re-check commands:

```text
supabase db reset
npx vitest run
npm run typecheck
npm run lint
npm run check:craft
npm run build
```

No merge, push, production change, or database migration was performed in this run.
