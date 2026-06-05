# Codex Review — block5_ticket_cleanup
**Date:** 2026-06-04 19:04
**Project:** The Chain
**Project type:** MoreTech Product
**Phase:** 6 (Features)
**Unit reviewed:** block5_ticket_cleanup
**Review weight:** full
**Skills audited:** (none)
**Reviewer:** Codex CLI (model: gpt-5.4)

---

## What was done

- Row provenance was partially threaded through the import stack. `CanonicalPayload.sourceRow` and `PullResultError.row` now exist in the contract, payload mapping stamps the CSV row, and both sync and durable movement writers attach `item.sourceRow` to `unknown_sku` / `invalid_date` failures ([src/lib/source-adapter/index.ts](</Users/themoreapp/More Technologies/projects/the-chain/src/lib/source-adapter/index.ts:95>), [src/lib/import/transform.ts](</Users/themoreapp/More Technologies/projects/the-chain/src/lib/import/transform.ts:182>), [src/lib/import/commit.ts](</Users/themoreapp/More Technologies/projects/the-chain/src/lib/import/commit.ts:327>), [src/lib/import/durable-commit.ts](</Users/themoreapp/More Technologies/projects/the-chain/src/lib/import/durable-commit.ts:266>)).
- The browser upload path no longer hard-assumes UTF-8. `UploadZone` now reads `ArrayBuffer` and decodes through `decodeCsvBytes()`, which tries strict UTF-8 and falls back to Windows-1252 ([src/app/(app)/import/UploadZone.tsx](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/import/UploadZone.tsx:24>), [src/lib/import/parse.ts](</Users/themoreapp/More Technologies/projects/the-chain/src/lib/import/parse.ts:35>)).
- There is test coverage for the decode/date helpers and the Server Action boundary. The new tests verify UTF-8 vs Windows-1252 fallback, basic date-guard behavior, role gating, sync-vs-durable routing, revalidation, and generic error mapping ([tests/import/encoding-dates.test.ts](</Users/themoreapp/More Technologies/projects/the-chain/tests/import/encoding-dates.test.ts:13>), [tests/import/actions.test.ts](</Users/themoreapp/More Technologies/projects/the-chain/tests/import/actions.test.ts:53>)).
- The durable path now writes a `failed` status and the poller surfaces that state back to the client ([src/lib/import/durable-commit.ts](</Users/themoreapp/More Technologies/projects/the-chain/src/lib/import/durable-commit.ts:57>), [src/app/(app)/import/actions.ts](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/import/actions.ts:182>)).

## What wasn't done

- The CSV-import feature still does not have the required memorable artifact on disk. The contract requires `_reviews/<date>_feature_<name>_memorable.{png,test.ts}` and specifically calls for a Playwright capture of the mapping screen; what exists is jsdom RTL in `tests/import/mapper.memorable.test.tsx` and `tests/import/lanes.memorable.test.tsx`, not a `_reviews/..._memorable.*` artifact and not Playwright ([FEATURES.md](</Users/themoreapp/More Technologies/projects/the-chain/FEATURES.md:251>), [MASTER_PROMPT.md](</Users/themoreapp/More Technologies/projects/the-chain/MASTER_PROMPT.md:135>), [_reviews/_tickets.md](</Users/themoreapp/More Technologies/projects/the-chain/_reviews/_tickets.md:90>)).
- The feature-level performance and scale contract is still missing. `10k < 30s`, `50k no-OOM`, workflow-stream progress, and streaming-parse-at-threshold are still ticketed, not delivered ([FEATURES.md](</Users/themoreapp/More Technologies/projects/the-chain/FEATURES.md:240>), [_reviews/_tickets.md](</Users/themoreapp/More Technologies/projects/the-chain/_reviews/_tickets.md:87>), [src/lib/import/csv-adapter.ts](</Users/themoreapp/More Technologies/projects/the-chain/src/lib/import/csv-adapter.ts:74>)).
- The recurring “re-upload this kind of CSV” flow is still not built. The UI only offers “Import another file,” which is not the promised recurring-import path ([FEATURES.md](</Users/themoreapp/More Technologies/projects/the-chain/FEATURES.md:236>), [src/app/(app)/import/ImportFlow.tsx](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/import/ImportFlow.tsx:243>)).
- The workflow-boundary crash/resume integration proof is still absent. `_reviews/_tickets.md` says so explicitly, and the on-disk tests still exercise the durable core directly rather than a real workflow crash/retry cycle ([ _reviews/_tickets.md ](</Users/themoreapp/More Technologies/projects/the-chain/_reviews/_tickets.md:92>), [tests/import/durable-commit.test.ts](</Users/themoreapp/More Technologies/projects/the-chain/tests/import/durable-commit.test.ts:5>)).
- There is no proper evidence trail for this cleanup sweep beyond `_reviews/_tickets.md`. The claim “Suite 192/192” lives there, but there is no fresh `_reviews/2026-06-04_feature_csv_import.md` or `_evidence.md` proving this pass on disk ([MASTER_PROMPT.md](</Users/themoreapp/More Technologies/projects/the-chain/MASTER_PROMPT.md:31>), [_reviews/_tickets.md](</Users/themoreapp/More Technologies/projects/the-chain/_reviews/_tickets.md:70>)).

## What can be done better

- The row-provenance fix is incomplete where it matters operationally: persisted failures still do not consistently carry row numbers. Both write paths still insert `sync_failures.external_ref = e.externalId`, and writer-stage errors still set `externalId` to the SKU, not the row. So the UI preview improved, but the database record still mixes “row number” and “natural key” semantics ([src/lib/import/commit.ts](</Users/themoreapp/More Technologies/projects/the-chain/src/lib/import/commit.ts:114>), [src/lib/import/durable-commit.ts](</Users/themoreapp/More Technologies/projects/the-chain/src/lib/import/durable-commit.ts:105>), [src/lib/import/commit.ts](</Users/themoreapp/More Technologies/projects/the-chain/src/lib/import/commit.ts:328>)). That means the prior ticket is not actually closed against the feature contract that says failures land in `sync_failures` with row numbers.
- The failed-run handling is too blunt and contradicts the claim in `_tickets.md`. `runImportDurable()` marks the run failed on any thrown error, immediately, before any retry classification exists. That is not “deterministic failures only”; it will also mark transient step failures as failed and can race against later workflow retries ([src/lib/import/durable-commit.ts](</Users/themoreapp/More Technologies/projects/the-chain/src/lib/import/durable-commit.ts:60>), [_reviews/_tickets.md](</Users/themoreapp/More Technologies/projects/the-chain/_reviews/_tickets.md:77>)).
- `parseOccurredAt()` is still not the strict parse the ticket claimed. It is just `new Date()` behind a punctuation guard and year window. The earlier requirement was explicit TZ handling and preserving source fidelity; that is still not implemented ([src/lib/import/writers-shared.ts](</Users/themoreapp/More Technologies/projects/the-chain/src/lib/import/writers-shared.ts:36>), [_reviews/_tickets.md](</Users/themoreapp/More Technologies/projects/the-chain/_reviews/_tickets.md:34>), [tests/import/encoding-dates.test.ts](</Users/themoreapp/More Technologies/projects/the-chain/tests/import/encoding-dates.test.ts:33>)).
- Token discipline is still leaking. The import stylesheet still contains raw px values, including the exact `6px` / `12px` values already called out in tickets ([src/app/(app)/import/import.module.css](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/import/import.module.css:424>), [_reviews/_tickets.md](</Users/themoreapp/More Technologies/projects/the-chain/_reviews/_tickets.md:68>)).

## What was missed

- `startDurableImport()` can leave an orphaned `sync_runs` row in `running` if the workflow fails to start after the row insert. The action-level `try/catch` returns a clean error to the user, but nothing cleans up or marks that pre-created run as failed ([src/app/(app)/import/actions.ts](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/import/actions.ts:124>), [src/app/(app)/import/actions.ts](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/import/actions.ts:141>)).
- The new action-layer tests missed the durable failure path entirely. They cover the happy path for large files, but not `ensureCsvConnection()` failure, `start()` failure, or the orphan-run case above ([tests/import/actions.test.ts](</Users/themoreapp/More Technologies/projects/the-chain/tests/import/actions.test.ts:97>)).
- The encoding fix still does not satisfy the review checklist item “bad encoding fails with a clear error.” Any invalid UTF-8 byte stream now silently decodes as Windows-1252; there is no explicit “this file encoding is unreadable” path ([FEATURES.md](</Users/themoreapp/More Technologies/projects/the-chain/FEATURES.md:247>), [src/lib/import/parse.ts](</Users/themoreapp/More Technologies/projects/the-chain/src/lib/import/parse.ts:42>)).
- The import feature contract says cursor encodes parse position for resumability across long files. `CsvSourceAdapter.pull()` still ignores `cursor` and always returns `nextCursor: null`, so resumability remains write-stage-only, not adapter-stage ([FEATURES.md](</Users/themoreapp/More Technologies/projects/the-chain/FEATURES.md:230>), [src/lib/import/csv-adapter.ts](</Users/themoreapp/More Technologies/projects/the-chain/src/lib/import/csv-adapter.ts:74>)).

---

## Decisions (captured 2026-06-04 19:08)

- **Orphan sync_run on start() failure** — FIXED. `startDurableImport` marks the
  pre-created run failed if `start()` throws (+ action test).
- **sync_failures lacks row number** — FIXED. Both paths persist `payload:{row}`
  (external_ref stays the natural key); the DB record now carries both.
- **No fresh evidence doc** — FIXED. `_reviews/2026-06-04_block5_import_cleanup_evidence.md`.
- **Failed-marking "too blunt"** — comment corrected to be honest (marks on any throw;
  deterministic in practice; finalize overwrites on a successful retry). Precise
  Retryable/Fatal classification remains ticketed.
- **"bad encoding fails with a clear error"** — ACCEPT. Windows-1252 is a total
  decoding (every byte maps), so there is no unreadable-bytes path by design;
  structural CSV errors still surface via CsvParseError. Documented.
- **Memorable Playwright artifact / 10k-50k perf / workflow crash test / adapter
  cursor-chunking / recurring re-upload / raw-px** — STILL BLOCKED or accepted, all
  ticketed with reasons.
