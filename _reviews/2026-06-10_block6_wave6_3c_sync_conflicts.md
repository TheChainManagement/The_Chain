# Codex Review — block6_wave6_3c_sync_conflicts
**Date:** 2026-06-10 13:36
**Project:** The Chain
**Project type:** MoreTech Product
**Phase:** 6 (Features)
**Unit reviewed:** block6_wave6_3c_sync_conflicts
**Review weight:** full
**Skills audited:** none
**Reviewer:** Codex CLI (model: gpt-5.4)

---

## What was done

- The dead-end is actually closed. The QuickBooks strip now links pending conflicts into a real route at [src/app/(app)/integrations/quickbooks/IncrementalSyncControls.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/integrations/quickbooks/IncrementalSyncControls.tsx:103), and the route exists at [src/app/(app)/flow/sync-conflicts/page.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/flow/sync-conflicts/page.tsx:19).
- Conflict rows were widened so the resolver has enough state to do more than name/status swaps. Products now persist `name/description/unitOfMeasure/status` and suppliers persist `name/status/contact` in [src/lib/qbo/incremental-core.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/qbo/incremental-core.ts:219) and [src/lib/qbo/incremental-core.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/qbo/incremental-core.ts:348).
- There is a real pure planner for resolution logic in [src/lib/qbo/resolve.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/qbo/resolve.ts:131), and a real Server Action wrapper in [src/app/(app)/flow/sync-conflicts/actions.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/flow/sync-conflicts/actions.ts:32).
- The cockpit UI exists and is not a stub. It renders per-field diffs, merge picks, and a reconciled state in [src/app/(app)/flow/sync-conflicts/ConflictCockpit.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/flow/sync-conflicts/ConflictCockpit.tsx:29).
- There is at least pure-core test coverage for the planner in [tests/qbo/resolve.test.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/tests/qbo/resolve.test.ts:21), and incremental-core coverage still exercises LWW and `needs_review` creation in [tests/qbo/incremental-core.test.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/tests/qbo/incremental-core.test.ts:136).

## What wasn't done

- The Block 6 checklist requires `needs_review` to produce a conflict row **and** a `warn` alert. I found the conflict-row insert in [src/lib/qbo/incremental-core.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/qbo/incremental-core.ts:438), and I found no alert write anywhere in the QBO incremental path. That acceptance item is still open.
- The evidence file claims the resolver paths are covered, but only the pure planner is tested. There is no action-level or UI-level test for `resolveSyncConflict`; the only new file is [tests/qbo/resolve.test.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/tests/qbo/resolve.test.ts:1), and the incremental test file still stops at conflict creation in [tests/qbo/incremental-core.test.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/tests/qbo/incremental-core.test.ts:159).
- The required on-disk visible-craft artifact for this 2026-06-10 wave is missing. The evidence doc says it was “captured via Preview MCP” at [_reviews/2026-06-10_block6-wave6_3c-sync-conflicts.md](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-10_block6-wave6_3c-sync-conflicts.md:61), but there is no matching `_reviews/*memorable*` artifact for this date on disk. The only QBO memorable artifact present is [_reviews/2026-06-05_feature_qbo_connect_memorable.test.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-05_feature_qbo_connect_memorable.test.tsx:1).
- The repo status docs were not updated to reflect the shipped slice. README still says conflict-resolution UI is “Next” in [README.md](/Users/themoreapp/More%20Technologies/projects/the-chain/README.md:61).

## What can be done better

- Stop claiming “tokens only” while shipping raw values. The new styles hardcode px sizes and motion values all over [src/app/(app)/flow/sync-conflicts/sync-conflicts.module.css](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/flow/sync-conflicts/sync-conflicts.module.css:54) and [src/app/(app)/integrations/integrations.module.css](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/integrations/integrations.module.css:296). `140ms ease`, `44px`, `13px`, `6px`, `2px` is direct doctrine drift, not polish debt.
- The evidence trail is too fixture-heavy. The gallery embed in [src/app/gallery/page.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/gallery/page.tsx:259) proves the component can render sample data, not that the real `/flow/sync-conflicts` route behaves correctly against live pending rows and the real action.
- The new action does not follow the project’s own stated Server Action shape in [MASTER_PROMPT.md](/Users/themoreapp/More%20Technologies/projects/the-chain/MASTER_PROMPT.md:124). Positional args are creeping in via [actions.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/flow/sync-conflicts/actions.ts:32), which is how contract drift becomes house style.
- Accessibility discipline is weak here. The new interactive controls have hover styling, but no explicit `:focus-visible` treatment in [sync-conflicts.module.css](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/flow/sync-conflicts/sync-conflicts.module.css:157) or [integrations.module.css](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/integrations/integrations.module.css:296).

## What was missed

- The resolution write is not atomic. [resolveSyncConflict()](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/flow/sync-conflicts/actions.ts:110) updates the entity first, then separately marks the conflict resolved at [actions.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/flow/sync-conflicts/actions.ts:117). If the second write fails, you return an error but leave the catalog mutated and the conflict still pending. That is a real consistency bug.
- The Block 6 conflict-policy checklist still lacks the server-wins PO branch test. The checklist explicitly requires it in [FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:288), and the current incremental test file only covers clean refresh, LWW, `needs_review`, and movement append in [tests/qbo/incremental-core.test.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/tests/qbo/incremental-core.test.ts:136).
- The new surface misses the project-wide `:focus-visible` rule. That requirement is explicit in [MASTER_PROMPT.md](/Users/themoreapp/More%20Technologies/projects/the-chain/MASTER_PROMPT.md:28), and the new conflict badge, merge cells, and empty-state link ship without visible focus styling in [sync-conflicts.module.css](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/flow/sync-conflicts/sync-conflicts.module.css:12) and [integrations.module.css](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/integrations/integrations.module.css:296).
- The evidence file overstates completion. It says this wave lets an owner/manager “adjudicate every `needs_review` conflict” in [_reviews/2026-06-10_block6-wave6_3c-sync-conflicts.md](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-10_block6-wave6_3c-sync-conflicts.md:13), but legacy thin-state conflicts are explicitly called out as degraded at [that same file](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-10_block6-wave6_3c-sync-conflicts.md:77), there is no alert path, and there is no action-path test proving the end-to-end mutation. That is not “every.”

## Decisions (captured 2026-06-10)

### Atomicity, arg-shape, motion tokens, focus ring, action/UI test, README
- **Decision:** Fix now.
- **Action:** All fixed this slice (see the evidence file's "Codex review — round 1" section). 296 tests pass, build clean.

### `warn` alert on `needs_review` conflict (FEATURES.md:288)
- **Decision:** Ticket it (MG).
- **Action:** Logged under "Block 6 Wave 6.3-C — Codex round-1 tickets" in `_reviews/_tickets.md`, to fold into `logConflict` when the alerts-engine helper exists (shares the helper with the expired-refresh-token alert).

### PO server-wins branch test
- **Decision:** Out of scope (deferred).
- **Action:** Ticketed; blocked on the reorder engine (Blocks 7-9) generating app POs.

### Commit / push
- **Decision:** Hold — keep building (MG wants to knock out another wave/block first, then commit + push together).
- **Action:** Wave 6.3-C stays in the working tree; proceeding to the next unit.
