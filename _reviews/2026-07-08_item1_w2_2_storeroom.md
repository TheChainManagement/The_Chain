# Codex Review — item1_w2_2_storeroom
**Date:** 2026-07-08 20:00
**Project:** The Chain
**Project type:** MoreTech Product
**Phase:** 6 (Features)
**Unit reviewed:** item1_w2_2_storeroom
**Review weight:** full
**Skills audited:** (none)
**Reviewer:** Codex CLI (model: gpt-5.4)

---

## What was done

- The W2-2 schema work exists: `supabase/migrations/20260707200000_w2_2a_movement_enum.sql:14-17` adds `issue_out`, `issue_return`, `return_to_vendor`, `customer_return`; `20260707200100_w2_2b_storeroom_ops.sql:19-57` adds the demand-ref/reason/note columns, `location_kind`, CHECKs, and demand-ref index.
- The operator posting RPCs exist: `post_issue_movements`, `post_stock_adjustment`, and `close_cycle_count_session` are implemented in `supabase/migrations/20260707200100_w2_2b_storeroom_ops.sql:97-369`.
- App-layer role gates exist for owner/manager/warehouse in `src/app/(app)/inventory/storeroom-actions.ts:21-36` and `src/app/(app)/inventory/cycle-counts/actions.ts:18-28`.
- Issue/adjust UI exists through `InventoryLedger` and `OperatorPanel`; the inventory page shows issue only for issue-archetype tenants at `src/app/(app)/inventory/page.tsx:37-85`.
- Cycle-count surfaces exist at `/inventory/cycle-counts` and `/inventory/cycle-counts/[sessionId]`, with start, entry, close, and report rendering in `src/app/(app)/inventory/cycle-counts/page.tsx:29-87` and `src/app/(app)/inventory/cycle-counts/[sessionId]/page.tsx:38-140`.
- Demand routing exists: `src/lib/modes/demand.ts:16-32` maps sell to `sale` and issue to `issue_out`; forecast batch, classification, and detail history all call it (`src/lib/forecast/batch-core.ts:588-625`, `src/lib/classification/classify.ts:151-165`, `src/lib/forecast/detail.ts:268-275`).
- Tests exist for the DB layer and demand routing: `tests/storeroom/rpcs.test.ts`, `tests/modes/demand.test.ts`, and the audit detail fix in `tests/audit/event-detail.test.ts`.

## What wasn't done

- The required screenshot artifact was not delivered. The process requires “screenshot evidence in `_reviews/`” (`docs/NEXT_SESSION_KICKOFF_PROMPT.md:240-241`, `docs/WAVE2_SCOPE.md:83`), but the evidence admits there are no persisted Playwright artifacts: `_reviews/2026-07-07_item1_w2_2_storeroom_evidence.md:106-109`.
- Action-layer integration tests were not delivered. The evidence explicitly defers tests for `issueStock`, `adjustStock`, and count actions at `_reviews/2026-07-07_item1_w2_2_storeroom_evidence.md:106-107`. That leaves the service-role mutation boundary and role gate largely untested.
- Production migration readiness is not done. The evidence says the linked remote may not even have prior W2-1a recorded and requires verification before merge: `_reviews/2026-07-07_item1_w2_2_storeroom_evidence.md:110-113`.
- `_reviews/_tickets.md` was not updated for this slice’s new deferrals, even though the session protocol says to update it when the item lands (`docs/NEXT_SESSION_KICKOFF_PROMPT.md:242`). The evidence creates new deferred items, but they are not reflected in the ticket ledger.
- No skills were declared invoked, so there is no skill compliance artifact trail to audit.

## What can be done better

- `close_cycle_count_session` is falsely described as idempotent. The RPC checks terminal session status before checking the idempotency key (`supabase/migrations/20260707200100_w2_2b_storeroom_ops.sql:284-300`), so a replay after a successful close raises `session_terminal` instead of returning `out_applied=false`. The client comment claims “a double-click replays as a no-op” (`src/app/(app)/inventory/cycle-counts/[sessionId]/CloseCount.tsx:10-14`), and the migration header claims retried requests replay as no-ops (`supabase/migrations/20260707200100_w2_2b_storeroom_ops.sql:59-63`). That is wrong for count close.
- The tests miss that idempotency defect. `tests/storeroom/rpcs.test.ts:304-319` only checks re-close with a different key and nothing-counted failure. There is no same-key replay test for `close_cycle_count_session`, even though issue and adjustment do have replay tests.
- The DB tests run the RPC layer as a privileged DB client and do not exercise the actual Server Actions. The highest-risk path here is “user role claim -> service-role RPC -> tenant-scoped stock mutation,” but the committed tests do not prove planner/viewer rejection or warehouse success at the action boundary.
- The naming is sloppy enough to become future debt: `loadSaleMovements` now loads mode-routed demand (`src/lib/forecast/batch-core.ts:588-625`). The behavior is correct, but the name tells the next engineer the opposite.

## What was missed

- The idempotency acceptance story was missed for the count close path. A retry after the first close can surface an error to the operator even though the first request succeeded. That is exactly the failure idempotency keys exist to prevent.
- The documentation trail is stale. `SYSTEM_DESIGN.md` still describes `stock_movements` with only `sale/receipt/transfer_in/transfer_out/adjustment/cycle_count` and no W2-2 demand-ref columns, while the implemented schema now has new movement types and columns. This matters because future procurement and posting-kernel work are supposed to build from the system contract.
- The process gate is still being normalized away. The evidence calls missing screenshot artifacts a “standing infra gap,” but the Wave 2 gate explicitly requires screenshot evidence. Repeatedly substituting prose for artifacts makes the checkpoint weaker each time.
- The feature claims “all visible in the audit log,” but the durable proof is thin: the audit visibility fix is a pure transform test (`tests/audit/event-detail.test.ts`), not an end-to-end audit read after real issue/adjust/count actions.

---

## Decisions (captured 2026-07-08, fixes applied at MG's standing "fix the clear bugs" bar)

Note the review header says model gpt-5.4; the run used gpt-5.5 (header string is a script
default, same as the Item 0 review).

### close_cycle_count_session idempotency is broken for same-key replay after close (What can be done better #1, What was missed #1)
- **Decision:** Fix now. Genuine correctness bug — the exact failure idempotency keys exist
  to prevent. Codex round-1's best catch.
- **Action:** The idempotency claim now happens BEFORE the terminal-status check (a raise
  still rolls the claim back, so a failed close never burns the key). Migration edited in
  place (never shipped anywhere) + function re-applied to the local DB from the file. New
  same-key replay-after-close test (`tests/storeroom/rpcs.test.ts`), which fails against
  the old ordering.

### No same-key replay test for count close (What can be done better #2)
- **Decision:** Fix now (with the bug).
- **Action:** Added; storeroom RPC suite is now 14 cases.

### Action boundary untested (What wasn't done #2, What can be done better #3)
- **Decision:** Fix now — converted the standing deferral into done for this slice.
- **Action:** `tests/storeroom/actions.test.ts` (15 cases): owner/manager/warehouse allowed
  with the actor threaded, planner/finance/viewer rejected BEFORE any write, validation
  short-circuits, RPC failure passthrough, revalidation. Mirrors the import action-test
  pattern.

### loadSaleMovements name lies about mode-routed demand (What can be done better #4)
- **Decision:** Fix now.
- **Action:** Renamed `loadSaleMovements` → `loadDemandMovements` (batch-core) and
  `loadAllSales` → `loadAllDemandHistory` (forecast detail).

### SYSTEM_DESIGN.md schema drift (What was missed #2)
- **Decision:** Fix now. Future procurement/kernel work builds from this contract.
- **Action:** stock_movements entry updated (10-type enum, demand-ref envelope, reason,
  note, partial index, W2-2 CHECKs); locations gains location_kind; inventory_op_events
  documented as the operator idempotency ledger + posting-RPC contract.

### _tickets.md not updated (What wasn't done #4)
- **Decision:** Fix now.
- **Action:** New "W2-2 storeroom — deferred" block: returns UI, MG's count-list design
  question, E2E audit-read test, prod migration reconciliation at merge.

### Screenshot artifacts on disk (What wasn't done #1, What was missed #3)
- **Decision:** Accept for this slice; the point about normalization is taken. The
  Playwright harness is the standing infra ticket, and MG personally ran the walkthrough
  this time (the strongest form of the evidence this gate wants).
- **Action:** None this slice; the harness ticket stands.

### Prod migration readiness (What wasn't done #3)
- **Decision:** Accept as a merge-gate task (already in the evidence + now in _tickets.md).
  Not a code change; runs at push time with MG's go.
- **Action:** Ticketed with the exact migration list.

### E2E audit-read proof (What was missed #4)
- **Decision:** Accept — ticketed with the standing seeded-auth harness item.
- **Action:** Ticketed.

All "fix now" items complete: suite 755/755, tsc/biome/craft clean. Awaiting MG's explicit
"push" (which includes the prod-migration reconciliation) before anything leaves the branch.
