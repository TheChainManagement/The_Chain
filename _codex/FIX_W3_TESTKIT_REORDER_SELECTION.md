# Codex fix: stale reorder selection survives navigation and blocks submission

Found by MG during the W3 wave-close live test (2026-07-25, TEST_KIT_W3 scenario 7 to 8
handoff). One finding, UI layer only. The RPC guard behaved correctly.

## WORKSPACE PREFLIGHT (verify before touching anything)

- Repository: `TheChainManagement/The_Chain`, local path
  `/Users/themoreapp/More Technologies/projects/the-chain`
- Base: current `main` (tip `841726a` or later).
- Branch to create: `codex/w3-testkit-fix-reorder-selection`, cut fresh off `main`.
- Sanity files that MUST exist: `src/app/(app)/reorder/ReorderQueue.tsx`,
  `src/lib/reorder/convert.ts`.
- If any mismatch, STOP and report; do not adapt.
- Do NOT merge to main, do NOT push main, do NOT touch production (Vercel or Supabase
  `hdpivaufoqokeuzgftsj`) in any way. No migrations are needed for this fix.

## The defect (diagnosed, verified in code 2026-07-25)

Repro (MG, live): planner submits recommendation A (over-limit, queues a requisition,
router.push to the requisition page). Planner navigates BACK to /reorder. Next.js
restores the client component with its old state: `selected` still contains A's id.
A's recommendation is now closed, so its row no longer renders. Planner checks
recommendation B: footer shows "2 selected" with one visible row, and Submit purchase
request fails with "One of those recommendations is no longer open" (`not_open` from
the RPC). There is no way to remove the ghost id because its checkbox does not exist.

Root cause: `src/app/(app)/reorder/ReorderQueue.tsx` line 43. `selected` is a
`useState<Set<string>>` that is never reconciled against the `groups` prop. Rows can
disappear (submit elsewhere, recompute, another user converting) while their ids stay
selected forever.

## The fix

1. Reconcile selection against visible rows. Derive the set of valid row ids from
   `groups` and drop any selected id not in it, so the count and the submitted payload
   can only ever contain rows the planner can see. Prefer deriving at render/use time
   (a `useMemo` valid-id set intersected wherever `selected` is read: `selectedCount`,
   `convert`, `requestQuotes`, checkbox `checked`) or a targeted effect keyed on
   `groups`; either is acceptable, but the invariant is: no id absent from `groups` is
   ever counted or submitted. Clear `selectedGroup` when the intersection empties.
2. Clear selection state after a successful `convert()` or `requestQuotes()` before
   navigating away, so a restored page starts clean even when Next.js resurrects state.
3. Keep the `not_open` server guard exactly as is. It is the last line of defense and
   it worked.

## Acceptance

- Repro above no longer reproduces: after submitting A and coming back, the footer
  shows only what is visible and checking B then submitting succeeds.
- Selecting rows, navigating away WITHOUT submitting, and coming back never produces a
  count higher than the visible checked rows.
- Playwright: extend the reorder spec with the stale-selection flow (submit A, back,
  select B, submit B succeeds; count never exceeds visible checked rows). Deterministic
  seeds per the existing test conventions.
- Full suite green, tsc clean, Biome clean, production build passes.
- Evidence per PROCESS.md Hard Rule 8: dated `_reviews/` evidence file plus an entry in
  `_agentic-os/projects/the-chain/CHECKPOINT_REVIEW.md`, then stop for the re-check.
- House style: no em dashes or en dashes anywhere, design tokens only.
