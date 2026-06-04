# Codex Review — block5_wave5_2_durable
**Date:** 2026-06-04 18:16
**Project:** The Chain
**Project type:** MoreTech Product
**Phase:** 6 (Features)
**Unit reviewed:** block5_wave5_2_durable
**Review weight:** full
**Skills audited:** (none)
**Reviewer:** Codex CLI (model: gpt-5.4)

---

## What was done

- Large-file routing is real. `runImport()` now branches at `DURABLE_THRESHOLD = 2000`, keeping small files synchronous and sending larger files into a Workflow DevKit path ([src/app/(app)/import/actions.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/import/actions.ts:41), [src/app/(app)/import/actions.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/import/actions.ts:69)).
- There is an actual `"use workflow"` / `"use step"` split on disk. `importWorkflow()` is orchestration-only and delegates to `importStep()` for the work ([src/workflows/import.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/workflows/import.ts:20), [src/workflows/import.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/workflows/import.ts:33)).
- The durable write core exists and does persist batch progress into `sync_runs.cursor`, then finalizes the run with imported/skipped/failed counters in the cursor payload ([src/lib/import/durable-commit.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/import/durable-commit.ts:67), [src/lib/import/durable-commit.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/import/durable-commit.ts:84), [src/lib/import/durable-commit.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/import/durable-commit.ts:329)).
- The client now has a real `running` state with a progress bar and poller wired to `getImportProgress()` ([src/app/(app)/import/ImportFlow.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/import/ImportFlow.tsx:17), [src/app/(app)/import/ImportFlow.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/import/ImportFlow.tsx:74), [src/app/(app)/import/ImportFlow.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/import/ImportFlow.tsx:184)).
- There is test coverage for the new durable core and the progress bar component, and the evidence file documents the shipped scope and remaining tickets ([tests/import/durable-commit.test.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/tests/import/durable-commit.test.ts:97), [tests/import/progress.test.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/tests/import/progress.test.tsx:17), [_reviews/2026-06-04_block5-wave5_2-durable.md](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-04_block5-wave5_2-durable.md:7)).

## What wasn't done

- The required memorable artifact is still missing. The CSV import feature contract requires a preview screenshot or Playwright interaction artifact for the memorable element ([FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:253), [MASTER_PROMPT.md](/Users/themoreapp/More%20Technologies/projects/the-chain/MASTER_PROMPT.md:135)). What exists is a jsdom unit test for `ProgressBar`, not a Playwright test and not a persisted screenshot artifact under `_reviews/..._memorable.*` ([tests/import/progress.test.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/tests/import/progress.test.tsx:1), [functions.exec_command output above showing no matching `_memorable` durable artifact on disk]).
- The feature-level performance contract is still not delivered. `FEATURES.md` requires `10,000-row CSV imports in under 30 seconds` and a `50,000-row` no-OOM stress run with progress ([FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:240)). The evidence file explicitly punts both to later tickets ([ _reviews/2026-06-04_block5-wave5_2-durable.md ](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-04_block5-wave5_2-durable.md:85), [_reviews/_tickets.md](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/_tickets.md:53)).
- True cursor-based chunking in the adapter is still not here. `CsvSourceAdapter.pull()` still returns `nextCursor: null` and ignores both `_cursor` and `_idempotencyKey`, so the durable path is resumable only at the write stage, not across parsing/pull as the broader CSV-import feature describes ([src/lib/import/csv-adapter.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/import/csv-adapter.ts:73), [src/lib/import/csv-adapter.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/import/csv-adapter.ts:93)).
- Latin-1 / Windows-1252 handling, true streaming parse, recurring re-upload UI, and the Server Action boundary test remain absent and are admitted as deferred in the evidence trail ([ _reviews/2026-06-04_block5-wave5_2-durable.md ](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-04_block5-wave5_2-durable.md:83), [_reviews/_tickets.md](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/_tickets.md:55)).

## What can be done better

- The durable supplier writer does not preserve the synchronous path’s contract. The sync path uses the `import_suppliers` RPC with `ON CONFLICT (tenant_id, lower(name))` ([src/lib/import/commit.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/import/commit.ts:269), [supabase/migrations/20260604120000_block5_import_writers.sql](/Users/themoreapp/More%20Technologies/projects/the-chain/supabase/migrations/20260604120000_block5_import_writers.sql:69)). The durable path bypasses that and upserts on `(tenant_id, id)` after a one-time prefetch of existing rows ([src/lib/import/durable-commit.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/import/durable-commit.ts:179), [src/lib/import/durable-commit.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/import/durable-commit.ts:214)). That is a drift vector: duplicate supplier names within one durable file or racey concurrent inserts are not resolved by the same natural key.
- The durable path never revalidates the affected app surfaces after background completion. `revalidatePath()` is called only on the synchronous branch in `runImport()` ([src/app/(app)/import/actions.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/import/actions.ts:79), [src/app/(app)/import/actions.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/import/actions.ts:89)). The workflow path writes out-of-band and finishes with no cache invalidation hook. If any of those screens are cached, the “View catalog / View suppliers” links can land on stale data.
- Token discipline is still being chipped away. The new progress styles hardcode `6px` and `12px` instead of using token vars, which is directly against the project rules ([src/app/(app)/import/import.module.css](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/import/import.module.css:424), [src/app/(app)/import/import.module.css](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/import/import.module.css:436), [MASTER_PROMPT.md](/Users/themoreapp/More%20Technologies/projects/the-chain/MASTER_PROMPT.md:12)).
- The “memorable element” evidence is weak and off-contract. A unit test asserting `style.width = '48%'` is not a visible-craft artifact for a Phase 6 gate. This project explicitly asks for preview screenshot or Playwright interaction proof, not a jsdom approximation ([tests/import/progress.test.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/tests/import/progress.test.tsx:18), [FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:6)).

## What was missed

- The durable path still loses writer-stage CSV row provenance. It repeats the same bug the prior review called out: `summary.failures` uses `row: Number(e.externalId) || 0`, while movement writer errors use the SKU as `externalId`, so the UI degrades bad rows to `0` and `sync_failures.external_ref` stores SKU instead of row number ([src/lib/import/durable-commit.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/import/durable-commit.ts:101), [src/lib/import/durable-commit.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/import/durable-commit.ts:252), [_reviews/_tickets.md](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/_tickets.md:31)). That issue was known and still shipped forward.
- The step-failure path is not just incomplete, it breaks the client contract. `getImportProgress()` only distinguishes `completed`, `running`, and `unknown`; it has no `failed` state ([src/app/(app)/import/actions.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/import/actions.ts:47), [src/app/(app)/import/actions.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/import/actions.ts:162)). The evidence file admits terminal failures leave `sync_runs.status='running'` and the UI falls back to a soft handoff after eight minutes ([ _reviews/2026-06-04_block5-wave5_2-durable.md ](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-04_block5-wave5_2-durable.md:77)). That means the new “durable progress” surface can lie about state indefinitely.
- The “same final state as a clean run” claim is under-tested at the actual workflow boundary. The tests exercise `runImportDurable()` directly, not `importWorkflow`, not a deliberate process crash, and not a resumed Workflow DevKit run ([tests/import/durable-commit.test.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/tests/import/durable-commit.test.ts:97), [src/workflows/import.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/workflows/import.ts:20)). That is not the acceptance criterion the onboarding/CSV contracts ask for.
- `parseOccurredAt()` still normalizes with `new Date(raw).toISOString()` ([src/lib/import/writers-shared.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/import/writers-shared.ts:33)). The prior review already flagged strict parsing / timezone fidelity as open, and this slice did not close it ([ _reviews/_tickets.md ](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/_tickets.md:35)).

---

## Decisions (captured 2026-06-04 18:18)

### Durable path never revalidates app surfaces after background completion
- **Decision:** Fix now.
- **Action:** `getImportProgress` calls `revalidatePath(REVALIDATE_BY_KIND[kind])` (kind from `sync_runs.cursor`) when it first sees `completed`, so `/inventory` / `/suppliers` aren't stale after a durable import. Fires ~once (the client stops polling on completion).

### Progress contract has no `failed` state ("can lie indefinitely")
- **Decision:** Fix now (the surfacing half).
- **Action:** Added `failed` to `ImportProgress`; `getImportProgress` maps `sync_runs.status='failed'` to it; the client poller shows the error and returns to preview. The other half — actually marking a run `failed` on a terminal (FatalError) step failure — stays ticketed (RetryableError/FatalError classification, so transient retries don't flash a false failure).

### Durable supplier writer uses (tenant_id,id) prefetch, not the lower(name) RPC
- **Decision:** Accept (converges).
- **Rationale:** The workflow has no JWT, so the SECURITY-INVOKER RPC can't run. The durable path prefetches lower(name)→id and the `suppliers_tenant_lower_name_uniq` index is the backstop: in-file case-dups are already collapsed by `mapRows` (shared), and a concurrent-insert race throws on the unique index → the idempotent retry heals it. Same end state as the sync path.

### Memorable artifact wants a Playwright/screenshot, not jsdom
- **Decision:** Accept / ticket.
- **Rationale:** The progress bar was verified live (2,500-row durable import → done screen + full catalog screenshot, viewed inline) but the preview tool doesn't persist screenshots in this env. `progress.test.tsx` is the on-disk RTL artifact. Wiring a Playwright harness for memorable-element artifacts is its own infra task → ticket.

### Perf bench / adapter cursor-chunking / Latin-1 / streaming / recurring re-upload / row provenance / occurred_at strict parse
- **Decision:** Ticket (deferred 5.2 items + carried-forward). No change.

### Workflow-boundary crash-resume test (tests hit runImportDurable, not importWorkflow + a real crash)
- **Decision:** Ticket.
- **Rationale:** The workflow path itself was live-verified (cursor.done proves the run went through `importWorkflow`); the resume LOGIC is unit-tested on the core. A DevKit-level process-crash integration test needs the workflow runtime in the harness → ticket.

### Raw px (6px/12px) in the progress styles
- **Decision:** Ticket → stack-audit (folds into the existing import.module.css raw-px ticket).
