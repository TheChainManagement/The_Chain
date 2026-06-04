# Block 5 — CSV import, Wave 5.2-durable (workflow + progress)

*Date: 2026-06-04. Phase 6, Tranche B. Built + live-verified, committed local. NOT yet Codex-gated or pushed.*

> **Scope:** the headline durability half of Wave 5.2. Large imports now run as a
> Workflow DevKit `"use workflow"` orchestration that survives a crash and resumes,
> with a live progress bar. The remaining 5.2 items (Latin-1 decode, true streaming
> parse, recurring re-upload UI, writer-stage row provenance, action-layer test)
> stay ticketed in `_reviews/_tickets.md`.

## What shipped

- **Threshold-gated execution** (`actions.ts`): imports over `DURABLE_THRESHOLD`
  (2000 rows) start the durable workflow and return a tracking key; smaller files
  stay on the synchronous RLS path (instant, defense-in-depth intact). One action,
  two paths.
- **`importWorkflow`** (`src/workflows/import.ts`): a `"use workflow"` orchestrator
  whose single `"use step"` wraps the durable core. Follows the smoke-test directive
  boundary (orchestrator only sequences; all I/O in the step) and logs entry/exit.
- **Durable write core** (`src/lib/import/durable-commit.ts`): runs inside the step,
  detached from the user session, so it writes through the **service-role admin
  client** with explicit `tenant_id` (authorized at the action gate — same trust
  model as the QBO/cron workflows in SYSTEM_DESIGN §Workflows). Crash-safe by two
  properties:
  - **Idempotent writes** — products upsert on (tenant_id, sku); suppliers resolve
    lower(name)→id and upsert on the PK (the case-insensitive RPC needs a JWT the
    workflow doesn't have); movements skip on the content-hash `source_ref`.
  - **Cursor resume** — progress (processed/total) is written to `sync_runs.cursor`
    after every 500-row batch; a retry skips whole batches already past the cursor.
  - The idempotency-critical `source_ref` + date parse are shared with the
    synchronous path via the new `writers-shared.ts`, so a file imported one way and
    re-uploaded the other collides on the same key (can't drift).
- **Live progress bar** (`ImportFlow.tsx` + `getImportProgress`): on an async result
  the flow enters a `running` step and polls `sync_runs` (RLS, tenant-scoped) every
  800ms, rendering a cobalt fill (`N of M rows`) until the run completes, then shows
  the normal done summary. Poll has a soft cap (~8 min) that hands off gracefully.

## Auth model note (the fork MG approved)

A DevKit run is detached from the user's login session by design (so it survives
crashes / runs from cron). Its writes therefore can't use the caller's RLS client;
they use the service-role client with `tenant_id` set explicitly, authorized once
at the Server Action gate before `start()`. This is the SYSTEM_DESIGN-specified
pattern for the QBO/cron workflows; the CSV durable path is the first to use it.

## Live verification (dev :3100, owner `durable-verify@thechain.test`)

Imported a generated **2,500-row** product CSV (over the threshold) through the UI
by injecting a real `File`:

1. **Routing:** the commit returned an async result → the flow entered the `running`
   step (the durable path, not the synchronous one).
2. **Completion:** the poller surfaced **"2,500 products landed. Every row passed."**
   (In dev the Local World runs steps synchronously, so the bar completes instantly;
   on Vercel it streams incrementally. The poll→done transition is the same.)
3. **Catalog:** `/inventory` rendered full of the imported BIG-* SKUs (screenshot).
4. **DB confirm (admin):** 2,500 products written; the latest `sync_run` is
   `status=completed` with `cursor.done=true, total=2500, imported=2500` — a marker
   **only the durable finalize sets** (the synchronous path never writes a cursor),
   so this proves the run went through the workflow, not the inline path.

## Tests (+7; suite 178/178)

- `tests/import/durable-commit.test.ts` (integration, admin path) — products write
  + sync_run finalize with cursor.done; **idempotent fresh re-run** (no dupes);
  **resume** (cursor at total → skips, re-counts, doesn't rewrite); movements write
  + auto Primary location + unknown-SKU failure; **content-hash dedup re-run**
  (imported 0 / skipped 2 / no double-post).
- `tests/import/progress.test.tsx` (RTL) — the `ProgressBar` memorable element fills
  to the processed/total percentage + the preparing (0) state.

typecheck / lint / craft clean.

## Open items (ticketed)

- **Terminal-failure propagation:** a step that ultimately fails (after DevKit
  retries) leaves the sync_run `running`; the client poll cap hands off softly but
  the run isn't marked `failed`. Needs RetryableError/FatalError classification +
  a failed-state write. → ticket.
- **Large-file input persistence:** the whole `csvText` is passed as the workflow
  input (persisted with the run). Fine for Wave 1; stage to Vercel Blob + read
  ranges for the 50k path. → ticket.
- **True streaming parse + Latin-1 + recurring re-upload UI + writer-stage row
  numbers + action-layer test** — remaining 5.2 items, still ticketed.
- The 50k stress + official 10k<30s p95 bench must run on a seeded Vercel Preview
  (Local World is synchronous, so dev timing isn't the SLO). → ticket.
