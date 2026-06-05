# Codex Review — block6_wave6_1_qbo_adapter
**Date:** 2026-06-05 16:16
**Project:** The Chain
**Project type:** MoreTech Product
**Phase:** 6 (Features)
**Unit reviewed:** block6_wave6_1_qbo_adapter
**Review weight:** full
**Skills audited:** (none)
**Reviewer:** Codex CLI (model: gpt-5.4)

---

## What was done

- The adapter slice is real, not vapor. `src/lib/qbo/adapter.ts`, `client.ts`, `transport.ts`, `map.ts`, `types.ts`, `capabilities.ts`, `fixtures.ts`, and `index.ts` all exist, and the code does implement the advertised seams: fetch transport, HTTP→adapter error mapping, pure mappers, pagination cursoring, and PO write-back via `DocNumber` lookup ([src/lib/qbo/adapter.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/qbo/adapter.ts:68), [src/lib/qbo/client.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/qbo/client.ts:39), [src/lib/qbo/map.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/qbo/map.ts:91)).
- The fixture-driven preview path is real. `runQboSandboxSync()` wires `QboClient` + `QboSourceAdapter` against `FixtureTransport` and drains `product`, `supplier`, `purchase_order`, and `stock_movement` pulls to produce counts for the UI ([src/app/(app)/integrations/actions.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/integrations/actions.ts:53), [src/lib/qbo/fixtures.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/qbo/fixtures.ts:1)).
- The connect UI exists on disk. `/integrations`, `/integrations/quickbooks`, `ConnectPanel`, and `SyncChain` are present, and the left rail was updated to expose the new route ([src/app/(app)/integrations/page.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/integrations/page.tsx:55), [src/app/(app)/integrations/quickbooks/page.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/integrations/quickbooks/page.tsx:10), [src/app/(app)/integrations/quickbooks/ConnectPanel.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/integrations/quickbooks/ConnectPanel.tsx:68), [src/components/bench/LeftRail.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/components/bench/LeftRail.tsx:16)).
- There is real test coverage for the slice that was actually built. `tests/qbo/adapter.test.ts` covers pagination, movement walking, and push idempotency; `tests/qbo/connect.memorable.test.tsx` covers the presentational chain states; `client.ts` has the error-taxonomy implementation the evidence doc claims ([tests/qbo/adapter.test.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/tests/qbo/adapter.test.ts:14), [tests/qbo/connect.memorable.test.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/tests/qbo/connect.memorable.test.tsx:14), [_reviews/2026-06-05_block6-wave6_1-qbo-adapter.md](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-05_block6-wave6_1-qbo-adapter.md:17)).

## What wasn't done

- The feature contract was not delivered. The block requires OAuth connect, `/api/qbo/oauth/callback`, encrypted token storage, `qboInitialSyncWorkflow`, `qboIncrementalSyncWorkflow`, webhook handling, conflict resolution, and disconnect flow ([FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:267), [FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:268), [FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:270), [FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:271), [FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:272), [FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:273)). None of those artifacts are on disk outside the self-declared deferral note in the review file ([ _reviews/2026-06-05_block6-wave6_1-qbo-adapter.md ](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-05_block6-wave6_1-qbo-adapter.md:52)).
- The “Connect” CTA does not initiate OAuth as the build sequence requires. It runs `runQboSandboxSync()` and never leaves the fixture path ([FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:267), [src/app/(app)/integrations/quickbooks/ConnectPanel.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/integrations/quickbooks/ConnectPanel.tsx:86)).
- The required memorable artifact is missing on disk. The project rule is explicit: the proof must land in `_reviews/<date>_feature_<name>_memorable.{png,test.ts}` or the feature is not done ([MASTER_PROMPT.md](/Users/themoreapp/More%20Technologies/projects/the-chain/MASTER_PROMPT.md:21), [MASTER_PROMPT.md](/Users/themoreapp/More%20Technologies/projects/the-chain/MASTER_PROMPT.md:135)). `find _reviews ... '*qbo*memorable*'` returned nothing. What exists is a jsdom unit test at `tests/qbo/connect.memorable.test.tsx`, which is not the required `_reviews/..._memorable.test.ts`.
- `inventory_level` support is still absent. The feature is native QBO integration; the shipped capabilities explicitly hard-disable `readInventory`, and the evidence doc admits the mapping is deferred ([src/lib/qbo/capabilities.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/qbo/capabilities.ts:13), [src/lib/qbo/capabilities.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/qbo/capabilities.ts:20), [_reviews/2026-06-05_block6-wave6_1-qbo-adapter.md](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-05_block6-wave6_1-qbo-adapter.md:56)).
- The acceptance items around 60-second OAuth-to-first-sync, token refresh alerts, 15-minute cron, webhook signature verification, conflict-policy branch tests, and disconnect behavior are all unimplemented, not merely unverified ([FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:276), [FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:277), [FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:278), [FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:288), [FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:289)).

## What can be done better

- The new stylesheet violates the project’s own token discipline and then lies about it. The header comment says “Tokens only” and “cobalt is reserved for the chain’s single intent slot,” but the file hardcodes `280px`, `36px`, `44px`, `13px`, `18px`, `14px`, `11px`, `720px`, and spends cobalt on `.sourceCta` and `.panelMark` chrome ([src/app/(app)/integrations/integrations.module.css](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/integrations/integrations.module.css:1), [src/app/(app)/integrations/integrations.module.css](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/integrations/integrations.module.css:7), [src/app/(app)/integrations/integrations.module.css](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/integrations/integrations.module.css:78), [src/app/(app)/integrations/integrations.module.css](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/integrations/integrations.module.css:113), [MASTER_PROMPT.md](/Users/themoreapp/More%20Technologies/projects/the-chain/MASTER_PROMPT.md:19)).
- The preview action throws away the adapter’s error taxonomy. `QboClient` carefully distinguishes `RetryableError`, auth fatal, and fault detail; `runQboSandboxSync()` catches everything and returns one generic string, so the UI cannot tell rate limiting from auth from mapper failure ([src/lib/qbo/client.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/qbo/client.ts:69), [src/app/(app)/integrations/actions.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/integrations/actions.ts:61)).
- The “memorable” test is too shallow to be useful. It renders `SyncChain` directly in jsdom and never drives `ConnectPanel`, the server action, or the actual pre-connect → mid-sync → post-sync transition the feature contract calls for ([tests/qbo/connect.memorable.test.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/tests/qbo/connect.memorable.test.tsx:15), [FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:292)).
- The evidence file overstates the craft result. It claims “Craft guard: PASS” and “tokens only” while the shipped CSS plainly breaks both token discipline and the cobalt hierarchy ([ _reviews/2026-06-05_block6-wave6_1-qbo-adapter.md ](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-05_block6-wave6_1-qbo-adapter.md:35), [ _reviews/2026-06-05_block6-wave6_1-qbo-adapter.md ](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-05_block6-wave6_1-qbo-adapter.md:42)).

## What was missed

- The adapter’s cursor logic is wrong and can drop records. `pull()` and `pullMovements()` carry `highWatermark` forward on every page, then immediately reuse it in the next page’s query while also advancing `STARTPOSITION` ([src/lib/qbo/adapter.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/qbo/adapter.ts:92), [src/lib/qbo/adapter.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/qbo/adapter.ts:104), [src/lib/qbo/adapter.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/qbo/adapter.ts:130), [src/lib/qbo/adapter.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/qbo/adapter.ts:142), [src/lib/qbo/adapter.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/qbo/adapter.ts:204)). That changes the filtered dataset between pages. If page 1 advances the watermark past rows that would have appeared on page 2, those rows are gone. Your tests never catch this because they only assert that a watermark exists, not that pagination with mixed timestamps is lossless ([tests/qbo/adapter.test.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/tests/qbo/adapter.test.ts:22), [tests/qbo/adapter.test.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/tests/qbo/adapter.test.ts:38)).
- The incremental watermark itself is underspecified and lossy. You only persist a timestamp and query `Metadata.LastUpdatedTime > '${highWatermark}'` ([src/lib/qbo/adapter.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/qbo/adapter.ts:210)). Rows sharing the same `LastUpdatedTime` across runs are vulnerable to being skipped because there is no tie-breaker key.
- The PO round-trip identity does not match the acceptance contract. The spec requires `tenant_id` and internal PO id as metadata fields on the QBO PO ([FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:279)). The implementation writes a shortened `DocNumber` plus a `PrivateNote` string. That is not metadata fields, and it is a weaker contract for future round-trip reads ([src/lib/qbo/map.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/qbo/map.ts:268)).
- The stock-movement mapping does not match the stated row identity contract. The feature says `source_ref = QBO entity id` ([FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:281)); the mapper emits synthetic per-line refs like `qbo:bill:401:1` and `qbo:sales:501:1` ([src/lib/qbo/map.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/qbo/map.ts:214), [src/lib/qbo/map.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/qbo/map.ts:240)). Maybe that is the better design. It is still a contract deviation.
- The “occurred_at matching QBO source date” claim is fuzzier than the code admits. The mapper rewrites date-only `TxnDate` values to midnight UTC (`YYYY-MM-DDT00:00:00.000Z`) instead of preserving the source value verbatim ([src/lib/qbo/map.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/qbo/map.ts:74), [src/lib/qbo/map.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/qbo/map.ts:204), [src/lib/qbo/map.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/qbo/map.ts:230)). That may be acceptable, but it is not the same thing as “matching QBO source date,” and nobody pinned the timezone behavior with a test.

---

## Decisions (captured 2026-06-05, MG: "Fix set + ticket rest, then push")

### Cursor drops records (What was missed)
- **Decision:** Fix now.
- **Action:** Split a constant `floor` (incremental filter, fixed per pull chain) from the
  running max watermark (persisted only) in `adapter.ts`; `buildStatement` filters on `floor`.
  Regression test added (`FilteringVendorTransport`) proving lossless pagination under a floor.

### CSS token discipline + cobalt on chrome (What can be done better)
- **Decision:** Fix now.
- **Action:** `.panelMark` + `.sourceCta` demoted to deep-slate (chain ignite is now the only
  cobalt on the surface); header comment corrected to stop overclaiming "tokens only".

### Memorable artifact missing at the MASTER_PROMPT path + too shallow (What wasn't done / better)
- **Decision:** Fix now.
- **Action:** Relocated to `_reviews/2026-06-05_feature_qbo_connect_memorable.test.tsx` (vitest
  include widened); deepened to drive the real `ConnectPanel` pre-connect→post-sync transition.

### Preview swallows error taxonomy (What can be done better)
- **Decision:** Fix now.
- **Action:** `runQboSandboxSync` now distinguishes Retryable / auth-fatal / fault.

### occurred_at TZ unpinned (What was missed)
- **Decision:** Fix now.
- **Action:** Test pins date-only→midnight-UTC and full-datetime-verbatim behavior.

### Watermark tie-breaker + terminal-page persistence (What was missed)
- **Decision:** Ticket (Wave 6.2 incremental sync — not exercised until incremental is wired).
- **Action:** Logged in `_reviews/_tickets.md`.

### PO round-trip uses DocNumber+PrivateNote vs "metadata fields" (What was missed)
- **Decision:** Keep + document (QBO has no arbitrary metadata KV; DocNumber is the queryable
  idempotency key). Revisit CustomField in 6.2 live write-back.
- **Action:** Documented in `_reviews/_tickets.md`.

### source_ref per-line vs bare entity id (What was missed)
- **Decision:** Keep + document (multi-line dedup needs per-line uniqueness).
- **Action:** Documented in `_reviews/_tickets.md`.

### Full feature contract (OAuth/workflows/cron/webhook/conflict/disconnect/inventory_level)
- **Decision:** Out of scope for Wave 6.1 by the MG-approved wave split; ticketed to 6.2/6.3.
- **Action:** Documented in the evidence doc + `_reviews/_tickets.md`.

### Ready to push?
- **Decision:** Yes (fix set complete, rest ticketed). 226/226, typecheck/lint/craft clean.
