# Block 5 import — ticket-cleanup sweep evidence

*Date: 2026-06-04. Phase 6, Tranche B. Built + verified, committed local. Codex round-1 done, fixes applied.*

A focused sweep to clear the recurring self-contained Codex findings across the
Block 5 import waves, so they stop re-appearing each review.

## What was done

1. **Writer-stage row provenance.** `CanonicalPayload.sourceRow` +
   `PullResultError.row` thread the 1-based CSV row through the stack. `rowToPayload`
   stamps it; both movement writers (sync `commit.ts`, durable `durable-commit.ts`)
   attach `item.sourceRow` to `unknown_sku` / `invalid_date` failures;
   `summary.failures.row` uses it; and `sync_failures.payload` now persists `{ row }`
   so the **database record** carries the row, not just the UI preview.
2. **Latin-1 / Windows-1252 decode.** `decodeCsvBytes` (UTF-8 strict → Windows-1252
   fallback). `UploadZone` reads the file as `ArrayBuffer` and decodes here instead
   of `readAsText` (which hard-assumed UTF-8 and mojibaked Excel exports).
3. **Strict `parseOccurredAt`.** A date-like punctuation guard + a sane year window
   reject bare numbers a loose `new Date()` would misread.
4. **Terminal-failure marking.** `runImportDurable` marks `sync_runs.status='failed'`
   on a thrown failure; `startDurableImport` marks the pre-created run failed if
   `start()` itself throws (no orphan stuck on 'running'); `getImportProgress` maps
   `failed` to a client state the poller surfaces.
5. **`runImport` Server Action-layer test.** Per-kind role gating, small/large
   threshold routing, revalidate, error mapping, and the start-failure orphan path.

## Verification

- **Encoding, live (the riskiest change — UploadZone now reads bytes):** on a clean
  dev compile, a normal UTF-8 import advanced upload→map→preview→commit and stored
  **"Café au lait"** intact in `products` (psql-confirmed). A raw **Latin-1** byte
  stream ("Crémerie Niño", é=0xE9 / ñ=0xF1) decoded correctly in-page via the exact
  `decodeCsvBytes` path (UTF-8 fatal → Windows-1252 fallback). Unit-covered for
  UTF-8, Windows-1252 fallback (é/ñ/ü), and the strict-date cases.
- **Tests:** +14 across `tests/import/actions.test.ts` (9: gating/routing/revalidate/
  error/orphan) and `tests/import/encoding-dates.test.ts` (6: decode + date guard).
  Suite **193/193**. typecheck / lint / craft clean.

## Codex round-1 (`_reviews/2026-06-04_block5_ticket_cleanup.md`) — disposition

- **Fixed:** orphan `sync_run` on `start()` failure (+ test); `sync_failures.payload`
  now stores the row number; failed-marking comment made honest; this evidence doc.
- **Accepted (rationale):** Windows-1252 fallback is intentionally *total* (every byte
  maps), so there is no "unreadable encoding" error path — structural parse failures
  are still surfaced by `CsvParseError`. Eager failed-marking is correct for the
  deterministic common case; precise Retryable-vs-Fatal classification is ticketed.
- **Still blocked (real infra):** Playwright memorable-element harness, 10k/50k perf
  bench on a seeded Vercel Preview, workflow-boundary crash-resume test, adapter-stage
  cursor chunking + streaming parse, recurring re-upload UI, raw-px→tokens (stack-audit).
  All tracked in `_reviews/_tickets.md`.
