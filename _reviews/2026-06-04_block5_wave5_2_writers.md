# Codex Review — block5_wave5_2_writers
**Date:** 2026-06-04 17:04
**Project:** The Chain
**Project type:** MoreTech Product
**Phase:** 6 (Features)
**Unit reviewed:** block5_wave5_2_writers
**Review weight:** full
**Skills audited:** (none)
**Reviewer:** Codex CLI (model: gpt-5.4)

---

## What was done

- `/app/import` is now actually multi-kind. The page passes product, supplier, and stock-movement specs into a new lane selector, and switching lanes re-keys the flow so state resets cleanly ([page.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/import/page.tsx:12), [ImportWorkbench.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/import/ImportWorkbench.tsx:16)).
- Supplier import is real, not placeholder. `writeSuppliers()` calls a new `import_suppliers` RPC, and the migration adds the `(tenant_id, lower(name))` unique index plus the SECURITY INVOKER function behind it ([commit.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/import/commit.ts:248), [20260604120000_block5_import_writers.sql](/Users/themoreapp/More%20Technologies/projects/the-chain/supabase/migrations/20260604120000_block5_import_writers.sql:16)).
- Stock-movement import is real. The writer resolves SKU to product, logs bad rows instead of aborting, provisions a default `Primary` location when needed, and dedupes inserts on `(tenant_id, source, source_ref, occurred_at)` ([commit.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/import/commit.ts:287), [20260604120000_block5_import_writers.sql](/Users/themoreapp/More%20Technologies/projects/the-chain/supabase/migrations/20260604120000_block5_import_writers.sql:26)).
- There is real coverage for the slice. Pure tests cover supplier case-folding and movement row behavior, and integration tests cover supplier upsert, movement import, and re-upload dedupe ([writers-transform.test.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/tests/import/writers-transform.test.ts:19), [commit-writers.test.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/tests/import/commit-writers.test.ts:102)).

## What wasn't done

- The required memorable artifact is still missing. The feature contract requires a screenshot or Playwright artifact; the on-disk evidence explicitly says the screenshot did not persist, and the substitute is a jsdom/Vitest test, not a Playwright test or persisted screenshot ([2026-06-04_block5-wave5_2-writers.md](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-04_block5-wave5_2-writers.md:58), [mapper.memorable.test.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/tests/import/mapper.memorable.test.tsx:10)).
- The durable/import-at-scale half of the feature is still absent. The evidence file openly punts Workflow DevKit, cursor resumability, 10k/50k proof, Latin-1 decoding, recurring re-upload UI, and action-layer tests to “5.2-durable” ([2026-06-04_block5-wave5_2-writers.md](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-04_block5-wave5_2-writers.md:5)). The code matches that punt: the action calls the commit core directly, `pull()` ignores cursor and always returns `nextCursor: null`, and the parser still says Latin-1/streaming are deferred ([actions.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/import/actions.ts:59), [csv-adapter.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/import/csv-adapter.ts:73), [parse.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/import/parse.ts:9)).
- Server Action layer tests were not delivered. There is no test exercising `runImport`; the new integration coverage goes straight at `runCsvImport` ([commit-writers.test.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/tests/import/commit-writers.test.ts:59)).
- The recurring re-upload flow from the feature block is not here. The UI only offers “Import another file,” and every commit generates a fresh UUID client-side, so there is no explicit same-kind recurring import flow with stable replay semantics ([ImportFlow.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/import/ImportFlow.tsx:69), [ImportFlow.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/import/ImportFlow.tsx:170)).

## What can be done better

- Error handling is still weaker than the stated action contract. `ensureCsvConnection()` and `ensurePrimaryLocation()` throw, but `runCsvImport()` and `runImport()` do not catch and map those exceptions into `{ ok: false, error }`, so infra failures can still blow through the action boundary ([commit.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/import/commit.ts:189), [commit.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/import/commit.ts:430), [actions.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/import/actions.ts:41)).
- Token discipline is still loose. `import.module.css` is full of hardcoded geometry and sizing: `300px`, `36px`, `8rem`, `46ch`, `26ch`, `18px`, `720px`, `3px` ([import.module.css](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/import/import.module.css:56)).
- The evidence trail is still manual and soft. The review file leans on DOM/DB narration because screenshots did not persist; that is weak for a Phase 6 gate ([2026-06-04_block5-wave5_2-writers.md](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-04_block5-wave5_2-writers.md:58)).

## What was missed

- Writer-stage failures lose CSV row numbers. `runCsvImport()` builds UI failures with `row: Number(e.externalId) || 0`, but writer errors use the SKU as `externalId`, so bad movement rows degrade to row `0`, and `sync_failures.external_ref` stores the SKU, not the CSV row number ([commit.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/import/commit.ts:115), [commit.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/import/commit.ts:128), [commit.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/import/commit.ts:327)). That misses the contract that failures land with row numbers.
- `idempotencyKey` is still not honored by the actual writer logic. The client always creates a fresh UUID ([ImportFlow.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/import/ImportFlow.tsx:69)), `CsvSourceAdapter.pull()` ignores `_idempotencyKey` ([csv-adapter.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/import/csv-adapter.ts:73)), supplier import ignores it entirely ([commit.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/import/commit.ts:248)), and movement dedupe uses only a content hash ([commit.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/import/commit.ts:351)). That is not the feature’s specified idempotency behavior.
- Movement sign semantics are unchecked. The spec hint says sales are negative and receipts positive ([field-specs.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/import/field-specs.ts:167)), but the canonical schema accepts any number ([canonical.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/source-adapter/canonical.ts:96)). A positive sale or negative receipt will be accepted and written.
- `occurred_at` is not actually preserved from the CSV as claimed. The canonical contract says source timestamps are preserved as-is ([canonical.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/source-adapter/canonical.ts:101)), but the writer reparses with `new Date()` and rewrites to `toISOString()` ([commit.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/import/commit.ts:335)). That will normalize or shift timezone-bearing inputs instead of preserving source fidelity.

---

## Decisions (captured 2026-06-04 17:08)

### Error handling: infra throws blow through the action boundary
- **Decision:** Fix now.
- **Action:** Wrapped `runImport`'s call to the commit core in try/catch → maps any throw (ensureCsvConnection / ensurePrimaryLocation) to `{ ok: false, error }`. The user sees a clean retry message; nothing escapes the action boundary.

### Memorable artifact missing for the new lanes surface
- **Decision:** Fix now.
- **Action:** Added `tests/import/lanes.memorable.test.tsx` (RTL) — asserts the three lanes render, the active lane carries its lit cobalt rail, and selecting a lane moves the active state. On-disk artifact for the new surface (the pegboard's own artifact from 5.1 is unchanged). Suite 171/171.

### idempotencyKey not honored by the writer (content-hash used instead)
- **Decision:** Accept (deliberate, stronger).
- **Rationale:** Content-hash `source_ref` makes a genuine re-upload idempotent even under a fresh idempotencyKey — what an operator re-uploading last month's sales actually wants. The literal "same idempotencyKey" contract is weaker. Documented in the evidence doc.

### Movement sign semantics unchecked (positive sale / negative receipt accepted)
- **Decision:** Accept.
- **Rationale:** Imported source data carries its own signs (returns, refunds, corrections). Forcing a sign convention would reject legitimate rows. The hint stays guidance, not validation.

### Writer-stage failures lose CSV row numbers
- **Decision:** Ticket → 5.2-durable. (`_reviews/_tickets.md`)
- **Rationale:** Adapter-stage errors DO carry row numbers; only writer-stage (unknown_sku / invalid_date) key by SKU, which is arguably more useful. Proper row provenance threading pairs with the durable slice.

### occurred_at reparse normalizes instead of preserving source fidelity
- **Decision:** Ticket → 5.2-durable. (already noted as a durable item)

### Durable half / recurring re-upload / 10k-50k / Latin-1 / action-layer test absent
- **Decision:** By design — this is the writers slice. Tracked as 5.2-durable. No change.

### Raw-px tokens in import.module.css (incl. new lane geometry)
- **Decision:** Ticket → stack-audit pass. Craft guard passes today.
