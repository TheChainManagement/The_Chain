# W3 test-kit reorder selection fix evidence

Date: 2026-07-27  
Branch: `codex/w3-testkit-fix-reorder-selection`  
Base: `main` at `73428fb`  
Scope: UI selection reconciliation only

## Preflight

- Repository path: `/Users/themoreapp/More Technologies/projects/the-chain`.
- Origin: `https://github.com/TheChainManagement/The_Chain.git`.
- `main` contains required base `841726a`.
- Starting worktree was clean.
- `src/app/(app)/reorder/ReorderQueue.tsx` and `src/lib/reorder/convert.ts` were present.
- The fix branch was created fresh from current `main`.
- No migration, production database, Vercel project, or production Supabase project was touched.

## Fix

`ReorderQueue` now derives the IDs present in the current `groups` prop and intersects every
selection read with that visible-ID set:

- the footer count uses only visible selections;
- checkbox checked state uses only visible selections;
- purchase-request submission uses only visible selections;
- quote-request submission uses only visible selections; and
- a targeted effect removes stale IDs from state, while `selectedGroup` is derived from the
  visible intersection and becomes null when that intersection is empty.

Both successful actions clear `selected` before calling `router.push`; the derived group clears
with it. Failure paths retain the visible selection so the planner can correct or retry.

`src/lib/reorder/convert.ts` is unchanged. The `not_open` RPC error mapping and database guard
remain the last line of defense.

## Deterministic regression coverage

Added `tests/reorder/queue-selection.test.tsx` with three focused interaction tests:

1. Select recommendation A, rerender the same client component after A disappears from
   `groups`, prove the footer resets and the remaining checkbox is clear, select B, and prove
   only B is submitted successfully.
2. Prove successful purchase-request conversion clears selection before navigation.
3. Prove successful RFQ creation clears selection before navigation.

This component-preserving rerender is the deterministic form of the Next.js restored-client-state
failure: local state survives while the server-provided visible rows change.

## Local browser verification

The documented local-only fixture was refreshed with `node scripts/seed-w3-testkit.mjs`.
The local app used `http://127.0.0.1:54321`; production was not accessed.

Using the bundled browser Playwright API:

- signed in as the seeded planner;
- selected `PMP-CENT-1`;
- submitted it and reached an approval-required requisition for `$620.00`;
- returned to the queue and observed one visible checkbox, no `2 selected` text, and the empty
  selection prompt;
- selected `FLG-WN-4` and observed exactly `1 selected` with exactly one visible checked row;
- submitted it successfully and reached a new `$350.00` purchase order.

The browser controller's history operation returned to `/today`, rather than restoring
`/reorder`, so the exact browser back-stack restoration was not reproduced by that controller.
The persistent-component regression test above directly exercises the stale-state condition.

## Playwright repository limitation

There is no persisted Playwright harness or reorder spec to extend in this repository:

- `package.json` has no Playwright dependency or script;
- there is no Playwright config or authenticated storage state; and
- `_reviews/2026-07-15_w2_fast_follow_decisions.md` explicitly records Playwright wiring as a
  separate infrastructure slice requiring isolated seed reset and CI artifact handling.

No non-runnable spec or unapproved browser-test foundation was added. Browser behavior was
verified through the bundled Playwright API, and the deterministic regression is persisted in
the existing Vitest/RTL harness. The re-check should treat a persisted Playwright spec as an
existing infrastructure dependency, not as completed work in this UI-only fix.

## Verification

- Focused reorder tests: PASS, 2 files and 5 tests.
- Full suite: PASS, 141 files and 995 tests.
- `npm run typecheck`: PASS.
- `npm run lint`: PASS, 366 source files.
- `npm run check:craft`: PASS.
- `npm run build`: PASS, including TypeScript and all 59 generated static pages.
- `git diff --check`: PASS.

The first sandboxed suite attempt could not access local Supabase at `127.0.0.1:54321`. It was
stopped and rerun with localhost permission; the complete rerun is the 141-file, 995-test result
reported above. The first sandboxed build stalled during compilation and was stopped; the
permitted rerun completed successfully in 22.6 seconds.

## Re-check focus

- Review the visible-ID intersection on every selection consumer.
- Confirm successful conversion and RFQ creation clear selection and its derived group before
  navigation.
- Re-run `tests/reorder/queue-selection.test.tsx` and the full suite.
- Confirm `src/lib/reorder/convert.ts` and all database guards remain unchanged.
- Repeat MG's live Back-button flow in a normal browser against the deterministic local seed.

Stop here for MG/Claude re-check. No merge or production action was performed.
