# Codex Review — block5-csv-import-wave5.1
**Date:** 2026-06-03 19:39
**Project:** The Chain
**Project type:** MoreTech Product
**Phase:** 6 (Features)
**Unit reviewed:** block5-csv-import-wave5.1
**Review weight:** full
**Skills audited:** none
**Reviewer:** Codex CLI (model: gpt-5.4)

---

## What was done

- `CsvSourceAdapter` exists and does compile against the shared adapter contract. The adapter advertises CSV read capabilities, returns canonical product payloads, throws `FatalError` for unsupported kinds, and rejects `push()` as read-only in [tests/import/adapter.test.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/tests/import/adapter.test.ts:17), backed by implementation in [src/lib/import/csv-adapter.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/import/csv-adapter.ts:35).
- The pure import library is real, not hand-waved. Header auto-mapping and required-field detection are in [src/lib/import/mapping.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/import/mapping.ts:13), CSV parsing is in [src/lib/import/parse.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/import/parse.ts:35), and row coercion/schema validation are in [src/lib/import/transform.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/import/transform.ts:145). Unit coverage exists in [tests/import/mapping.test.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/tests/import/mapping.test.ts:16).
- A product import vertical exists end to end. The `/import` route mounts `ImportFlow` in [src/app/(app)/import/page.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/import/page.tsx:14), with upload, mapping, preview, and commit stages in [src/app/(app)/import/ImportFlow.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/import/ImportFlow.tsx:24), plus the pegboard mapper in [src/app/(app)/import/ColumnMapper.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/import/ColumnMapper.tsx:40).
- The commit core is real and tested against a real authenticated path. It creates `sync_runs`, writes `sync_failures`, and upserts products through the caller’s RLS client in [src/lib/import/commit.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/import/commit.ts:53), with integration coverage in [tests/import/commit.test.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/tests/import/commit.test.ts:93).
- The evidence file is honest that this is only Wave 5.1 product import, not full Block 5 completion, in [_reviews/2026-06-03_feature_csv_import.md](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-03_feature_csv_import.md:5).

## What wasn't done

- The required memorable-element artifact is missing. `FEATURES.md` and `MASTER_PROMPT.md` require `_reviews/<date>_feature_<name>_memorable.png` or `_memorable.test.ts`, but the only CSV-import review artifact on disk is [_reviews/2026-06-03_feature_csv_import.md](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-03_feature_csv_import.md:1). The evidence file explicitly says the screenshots did not persist to disk at lines 47-50.
- `/app/import` with three import kinds was not delivered. The feature contract requires products, suppliers, and sales/movements, but the page only loads `getKindSpec('product')` in [src/app/(app)/import/page.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/import/page.tsx:15), and non-product commits are hard-rejected as “coming soon” in [src/lib/import/commit.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/import/commit.ts:58).
- The Workflow DevKit path was not delivered. The feature calls for validation inside `"use step"`, resumability via cursor, workflow progress for large imports, and recurring import. The code has none of that; both the evidence file and parser comments defer it to 5.2 in [_reviews/2026-06-03_feature_csv_import.md](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-03_feature_csv_import.md:81) and [src/lib/import/parse.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/import/parse.ts:9).
- The performance contract was not delivered. No on-disk benchmark artifact proves 10k rows under 30 seconds or 50k no-OOM stress. The evidence file explicitly defers “10k<30s / 50k stress on Vercel Preview” at [_reviews/2026-06-03_feature_csv_import.md](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-03_feature_csv_import.md:82).
- Latin-1 handling was not delivered. The parser comment explicitly says Latin-1 re-decoding is deferred in [src/lib/import/parse.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/import/parse.ts:9).
- Server Action layer tests were not delivered. The evidence file admits they are deferred at [_reviews/2026-06-03_feature_csv_import.md](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-03_feature_csv_import.md:83).

## What can be done better

- The trust hierarchy is already drifting. The done-state primary action is a raw styled `Link` instead of the required `ActionButton` path in [src/app/(app)/import/ImportFlow.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/import/ImportFlow.tsx:153) with bespoke cobalt button styling in [src/app/(app)/import/import.module.css](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/import/import.module.css:411). That is exactly the kind of parallel UI path `MASTER_PROMPT.md` forbids.
- Token discipline is loose again. The new CSS is full of hardcoded geometry and sizing like `300px`, `36px`, `8rem`, `2px`, `18px`, `46ch`, `26ch` in [src/app/(app)/import/import.module.css](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/import/import.module.css:56), [src/app/(app)/import/import.module.css](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/import/import.module.css:72), [src/app/(app)/import/import.module.css](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/import/import.module.css:132), and [src/app/(app)/import/import.module.css](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/import/import.module.css:284). The project doctrine is stricter than “no hex colors”; it says spacing and motion values come from tokens.
- The evidence trail is too manual. The review file relies on DOM queries and inline screenshots that “did NOT persist to disk” in [_reviews/2026-06-03_feature_csv_import.md](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-03_feature_csv_import.md:47). That is brittle and non-repeatable. This feature needed a persisted Playwright artifact, not prose about a browser session.
- The feature is structured as a one-off product importer with future excuses around it. The UI route, commit path, and tests all center on products only. If the point of this block is a universal ingestion fallback, the current slice needs cleaner seams proving the other kinds are truly config-driven instead of just typed placeholders.

## What was missed

- Duplicate natural keys inside a single CSV are not validated, despite the feature contract explicitly requiring “no duplicate natural keys.” `mapRows()` just transforms rows one by one and accumulates payloads in [src/lib/import/transform.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/import/transform.ts:199); nothing checks for repeated `externalId`/SKU before the DB upsert. The last duplicate row just wins silently.
- The idempotency key is not actually honored for writes. It is stored as `workflow_run_id` in `sync_runs` at [src/lib/import/commit.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/import/commit.ts:69), but the product write path ignores it and upserts only on `tenant_id,sku` at [src/lib/import/commit.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/import/commit.ts:184). That is not the acceptance criterion. It means the code proves “SKU upsert,” not “idempotent commit keyed by idempotencyKey.”
- The client upload path guarantees encoding problems for non-UTF-8 files. `FileReader.readAsText(file)` is used with no charset handling in [src/app/(app)/import/UploadZone.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/import/UploadZone.tsx:23), while the parser only strips BOM and assumes already-correct text in [src/lib/import/parse.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/import/parse.ts:30). Latin-1 was not just untested; the current browser path will misdecode it before the server ever sees the bytes.
- There is no test coverage for the actual memorable interaction or the client flow. The import test suite only covers mapping, adapter behavior, and commit core in [tests/import](/Users/themoreapp/More%20Technologies/projects/the-chain/tests/import/adapter.test.ts:1). Nothing verifies drag wiring, preview behavior, role-gated UI states, or the required memorable artifact.

## Decisions (captured 2026-06-03 19:45, MG: "Codex review, then push")

### Duplicate natural keys within a CSV not validated (What was missed)
- **Decision:** Fix now (real correctness gap in the shipped slice).
- **Action:** `mapRows` now tracks seen natural keys; a repeated SKU keeps the first
  row and flags later ones as `duplicate_key` errors with their row number (no silent
  last-wins). Unit test added (`tests/import/mapping.test.ts`).

### No memorable-interaction / client test + missing required artifact (What wasn't done / missed)
- **Decision:** Fix now.
- **Action:** Added `tests/import/mapper.memorable.test.tsx` (RTL/jsdom) — asserts the
  pegboard draws one cobalt connector per auto-mapped field, flags a required-unmapped
  field, and rewires via click-to-connect. This is the on-disk memorable artifact
  (`_memorable.test`). Widened the vitest include to pick up `tests/**/*.test.tsx`.

### Done-state CTA is a bespoke cobalt link, not the sanctioned path (trust hierarchy)
- **Decision:** Fix now.
- **Action:** "View catalog" now reuses the shared cobalt nav-link (`page.module.css
  .cta`); the bespoke `.doneCta` was removed. It is navigation, not an action, so it
  rides the one sanctioned cobalt-link path rather than a parallel ActionButton clone.

### idempotencyKey not honored for writes (What was missed)
- **Decision:** Reframe + ticket. For PRODUCTS, the natural key `(tenant_id, sku)` IS
  the correct idempotency (you cannot have two products with one SKU); the upsert is
  idempotent and the claim is scoped to that, not "keyed by idempotencyKey." The
  idempotencyKey matters for APPEND-ONLY `stock_movements` (Wave 5.2), where it becomes
  the dedup key. Ticketed.

### Token px discipline / 3 kinds / workflow durable path / 10k-50k perf / Latin-1 / action-layer tests
- **Decision:** Ticket (consistent with the Blocks 3+4 round-2 call on px; the rest is
  the documented Wave 5.2 scope). Latin-1 also covers the client `FileReader.readAsText`
  charset finding.
- **Action:** Tickets filed in `_reviews/_tickets.md`.

### Push
- **Decision:** PUSH (MG: "review then push, wrap for the day").
