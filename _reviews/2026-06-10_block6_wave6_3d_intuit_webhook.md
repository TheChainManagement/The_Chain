# Codex Review — block6_wave6_3d_intuit_webhook
**Date:** 2026-06-10 16:59
**Project:** The Chain
**Project type:** MoreTech Product
**Phase:** 6 (Features)
**Unit reviewed:** block6_wave6_3d_intuit_webhook
**Review weight:** full
**Skills audited:** none
**Reviewer:** Codex CLI (model: gpt-5.4)

---

## What was done

- The dead-end is genuinely closed now. The QuickBooks pending-conflict badge is a real link in [IncrementalSyncControls.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/integrations/quickbooks/IncrementalSyncControls.tsx:104), and the target route exists at [page.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/flow/sync-conflicts/page.tsx:19).
- The resolver got real backing code, not just UI. There is a Server Action in [actions.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/flow/sync-conflicts/actions.ts:38), a pure planner in [resolve.test.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/tests/qbo/resolve.test.ts:49), and widened stored conflict state in [incremental-core.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/qbo/incremental-core.ts:219) and [incremental-core.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/qbo/incremental-core.ts:348).
- The memorable artifact is now actually on disk. [_reviews/2026-06-10_feature_sync_conflicts_memorable.test.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-10_feature_sync_conflicts_memorable.test.tsx:1) exists and drives the real `ConflictCockpit` component.
- The webhook slice is real code on disk: pure signature/parser helpers in [webhook.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/qbo/webhook.ts:26), the route handler in [route.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/api/qbo/webhook/route.ts:35), and helper-level tests in [webhook.test.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/tests/qbo/webhook.test.ts:18).
- The project status docs were updated. README no longer says the conflict-resolution UI is “next”; it now claims it shipped at [README.md](/Users/themoreapp/More%20Technologies/projects/the-chain/README.md:61).

## What wasn't done

- The repo is claiming Block 6 is “contract-complete” when its own contract is still open. [README.md](/Users/themoreapp/More%20Technologies/projects/the-chain/README.md:61) and the feature prose in [FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:292) call the QBO sync complete except PO write-back, but the checklist at [FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:288) is still not met, and `_tickets` explicitly says so at [_reviews/_tickets.md](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/_tickets.md:200).
- The `needs_review` branch still does not write the required `warn` alert. The code only inserts/updates `sync_conflicts` in [incremental-core.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/qbo/incremental-core.ts:438), and the open ticket admits the alert is missing at [_reviews/_tickets.md](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/_tickets.md:201).
- “`resolveSyncConflict` accept_local / accept_remote / merge all paths exercised” is still not true. The contract requires that at [FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:288), but the only direct test coverage is the pure planner in [tests/qbo/resolve.test.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/tests/qbo/resolve.test.ts:49). The memorable test mocks the action instead of exercising it in [_reviews/2026-06-10_feature_sync_conflicts_memorable.test.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-10_feature_sync_conflicts_memorable.test.tsx:23).
- The PO server-wins branch test is still missing. That is still called out as required in [FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:288), and still tracked as open in [_reviews/_tickets.md](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/_tickets.md:202).

## What can be done better

- Stop writing “Tokens only” over token drift. [sync-conflicts.module.css](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/flow/sync-conflicts/sync-conflicts.module.css:1) still hardcodes `14px`, `11px`, `6px`, `44px`, `13px`, `2px`, `96px`, and `640px` across [lines 5-20]( /Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/flow/sync-conflicts/sync-conflicts.module.css:5), [60]( /Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/flow/sync-conflicts/sync-conflicts.module.css:60), [118]( /Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/flow/sync-conflicts/sync-conflicts.module.css:118), [247-260]( /Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/flow/sync-conflicts/sync-conflicts.module.css:247), and [319]( /Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/flow/sync-conflicts/sync-conflicts.module.css:319). The integration badge also hardcodes spacing and motion in [integrations.module.css](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/integrations/integrations.module.css:298).
- The evidence trail is still leaning on fixtures instead of the live route. The gallery showcase is explicitly fixture data in [gallery/page.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/gallery/page.tsx:13), and `_tickets` still admits the real-route E2E is missing at [_reviews/_tickets.md](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/_tickets.md:203).
- The webhook tests are too narrow for what the evidence claims. [tests/qbo/webhook.test.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/tests/qbo/webhook.test.ts:1) only covers the pure helper functions. It does not prove the route’s realm-to-connection lookup, in-flight coalescing, `sync_runs` creation, or failed-`start()` fallback in [route.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/api/qbo/webhook/route.ts:54).

## What was missed

- The resolve action still has a race that can falsely mark a conflict resolved without mutating the entity. It checks entity existence early at [actions.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/flow/sync-conflicts/actions.ts:102), then later does an unchecked update at [actions.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/flow/sync-conflicts/actions.ts:135). If the row disappears between those two steps, `writeErr` can stay null, the conflict remains claimed, and the action returns success after writing nothing.
- The async route still ships without segment-level loading/error surfaces. `page.tsx` does async data loading at [page.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/flow/sync-conflicts/page.tsx:19), but the folder has no `loading.tsx` or `error.tsx` at `src/app/(app)/flow/sync-conflicts/`. That misses the project’s “empty / loading / error states for every async surface” rule.
- The review story is still conflating “blocked” with “done.” `_tickets` says the missing `warn` alert and missing real-route E2E are deferred at [_reviews/_tickets.md](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/_tickets.md:201), [_reviews/_tickets.md](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/_tickets.md:203), but README and FEATURES prose are already selling Block 6 as effectively finished at [README.md](/Users/themoreapp/More%20Technologies/projects/the-chain/README.md:61) and [FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:292). That is status inflation, not closure.

## Decisions / round-1 dispositions (2026-06-10)

Note: this review swept the whole uncommitted diff (6.3-C + 6.3-D), so some findings re-state 6.3-C items.

**Fixed now:**
- **Resolve action race (real bug)** — a no-op `update` on a vanished entity returns no error, so the
  conflict could be marked resolved without applying. Fixed: the entity write now `.select('id')` and
  treats zero rows like a failure, releasing the claim and returning an error. Covered by the new
  "THE RACE" case in `tests/qbo/resolve-action.test.ts`.
- **Action-path test missing ("all paths exercised", FEATURES.md:288)** — added
  `tests/qbo/resolve-action.test.ts` (9 cases): accept_local / accept_remote / merge happy paths,
  merge-missing-field guard, non-owner gate, not-found, already-resolved, lost-claim race, and the
  vanished-entity race. Exercises the real action against a scripted fake Supabase client.
- **Status inflation** — README + FEATURES prose no longer call Block 6 "contract-complete." They now
  say the sync TRIGGERS are shipped and list the open checklist items (warn alert, PO test) + the
  blocked write-back explicitly.

**Pushed back (house-consistent, with evidence):**
- **"Tokens only" px drift** — the genuine drift (motion ms/cubic) was already tokenized in 6.3-C
  round-1. The remaining px are font-sizes + clip-path, which match the established components
  (`Panel.module.css`, `StatNumber.module.css` use the same px font sizes; no font-size token exists
  in `globals.css`). Not drift.
- **No `loading.tsx`/`error.tsx` for the segment** — the group-level `src/app/(app)/error.tsx` covers
  the route; no `(app)` segment has its own loading/error file. Omitting them is house-consistent.
- **Webhook route orchestration untested** — no route handler in the repo has an orchestration test
  (the identical, deployed cron route has none either). The pure helpers are tested. Ticketed
  alongside the route-layer harness rather than one-off here.

**Deferred (MG-approved earlier / blocked):**
- `warn` alert on `needs_review` (ticketed, alerts-engine wave); PO server-wins branch test (blocked
  on reorder engine); real-route E2E (Phase 7).
