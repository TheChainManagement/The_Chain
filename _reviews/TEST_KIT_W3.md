
## Results (MG walkthrough, Saturday 2026-07-25)

**One finding, everything else in line.** Scenarios up to the planner reorder pair ran
clean. Scenario 7 (over-limit queues for approval) behaved as designed.

### W3T-F1: stale reorder selection blocks the second submission (UI layer)
- Screen: /reorder, planner. After submitting the first recommendation (pump, queued
  for approval) and navigating back, the selection state still contained the closed
  recommendation's id. Footer read "2 selected" with one visible row; Submit failed
  with "One of those recommendations is no longer open" and the ghost id could not be
  unchecked (its row no longer renders).
- Root cause (verified in code): `ReorderQueue.tsx` `selected` state is never
  reconciled against visible rows; Next.js back-navigation restores the stale set.
  The `not_open` RPC guard fail-closed correctly; server behavior is NOT a finding.
- Severity: medium (blocks the batch flow, has a workaround via Select all / reload).
- Fix prompt ready: `_codex/FIX_W3_TESTKIT_REORDER_SELECTION.md` (branch
  `codex/w3-testkit-fix-reorder-selection` off main). Claude re-checkpoints after.
- Scenarios 8 and 9 (under-limit auto-approve incl. R4-F1 product fix, manager
  approval path) were BLOCKED by this finding at the time; re-run them after the fix
  round, plus 10 through 12 if they were not reached.
