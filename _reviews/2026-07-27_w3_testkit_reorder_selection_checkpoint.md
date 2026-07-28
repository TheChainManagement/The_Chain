# Checkpoint verdict: W3T-F1 stale reorder selection fix

Date: 2026-07-27 (evening session)
Reviewer: Claude (checkpoint per CODEX_PROTOCOL.md)
Branch: `codex/w3-testkit-fix-reorder-selection` off `main` @ `73428fb`
Scope: UI only. No migrations. Production untouched (verified: no Vercel or Supabase changes in diff).

## VERDICT: GO

The fix is correct, minimal, and lands the exact invariant the prompt required: no id absent
from `groups` is ever counted, shown checked, or submitted.

## What was reviewed (real diff, not the report)

- `src/app/(app)/reorder/ReorderQueue.tsx` (+55/-21): selection is now intersected with a
  memoized visible-id set at every read (footer count, checkbox checked, `convert()`,
  `requestQuotes()`); `selectedGroup` is derived from the visible intersection instead of held
  as parallel state, so it can never point at a vanished group; a targeted effect prunes stale
  ids from state; both successful submit paths clear selection before `router.push`.
- `tests/reorder/queue-selection.test.tsx` (new): 3 deterministic RTL tests. The first
  reproduces the exact W3T-F1 mechanism (client state preserved while rows change) via
  rerender with a changed `groups` prop, then proves only the visible row is counted and
  submitted. Tests 2 and 3 pin clear-on-submit for both action paths.
- `src/lib/reorder/convert.ts` untouched; `not_open` server guard intact as last defense.

## Adversarial pass (all clear)

- Prune effect terminates: `visibleSelected` is a subset of `selected`, so equal sizes imply
  equal sets; one prune converges, no render loop.
- Ghost id plus new group toggle: derived `selectedGroup` is null when nothing visible is
  selected, so the first toggle starts a fresh set; the ghost cannot ride along in the payload.
- Same-group toggle copies the pruned set, not raw state; stale ids cannot resurrect.
- Failure paths keep the visible selection so the planner can retry (correct behavior, and
  the error text stays visible).

## Gates (run independently, this machine)

- Suite: 141 files / 995 tests, all pass (was 992 at W3 close; +3 are the new regression tests).
- `tsc --noEmit`: clean.
- Biome: 34 pre-existing errors on `main` tip and identical 34 on the branch (all in
  `scripts/check-craft.mjs` and archived `_reviews/` test files). Delta from this fix: zero.
  Changed files individually clean.
- Production build: passes.
- Em dash scan on changed files: clean (the four `—` hits in ReorderQueue.tsx are pre-existing
  null-placeholder glyphs on `main`, untouched by this diff).
- Codex additionally drove the seeded local flow live (submit A, back, select B, submit B
  succeeds); see its evidence file.

## Notes (non-blocking)

1. The fix prompt asked for a Playwright spec, but this repo has no Playwright harness; the
   RTL regression matches the repo's actual convention and reproduces the defect mechanism
   deterministically. Prompt assumption error, not a build gap. If we ever stand up a
   Playwright harness, the Back-button flow belongs in its first batch.
2. Codex left the work uncommitted on the branch; committed during this checkpoint to protect
   it. No content changes made by the reviewer.

## Next

- MG re-runs TEST_KIT_W3 scenarios 8 and 9 (and 10 through 12 if not reached Saturday) against
  the branch build.
- Merge to main is MG's explicit call after the re-test.

Evidence companion: `_reviews/2026-07-27_w3_testkit_reorder_selection_evidence.md` (Codex).
