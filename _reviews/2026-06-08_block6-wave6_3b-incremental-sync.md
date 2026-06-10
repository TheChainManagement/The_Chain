# Block 6 Wave 6.3-B — QBO incremental sync (delta + conflict policy + cron)

**Date:** 2026-06-08
**Phase:** 6 (Features), Block 6 (QBO), Wave 6.3-B
**Skills invoked:** none new — feature wave on the locked DESIGN_DIRECTION.md + MASTER_PROMPT.md, reusing the established component vocabulary (ChainLink/StatNumber/ActionButton/Panel) and the workflow/action patterns from Waves 6.2b / 5.2.
**Artifacts reviewed against:** FEATURES.md (Block 6 steps 5-6), MASTER_PROMPT.md, SYSTEM_DESIGN.md (§Workflows, §Suppliers and procurement).

## What was built

The 15-minute delta that keeps a connected QuickBooks fresh after the first full sync, with a conflict policy so it never clobbers an operator's in-app edit.

- **`src/lib/qbo/conflict.ts` (pure):** the policy. A **fingerprint of QBO-owned field values** (stored in `external_ids.qbo_fp`) detects local edits — NOT a raw `updated_at` vs `external_updated_at` compare, which is broken by the `set_updated_at` trigger (every just-synced row would read as "locally edited"). `decideCatalogConflict` → insert / apply / keep, with `last_write_wins` (timestamp picks the winner once BOTH sides changed) and `needs_review` (ambiguous clocks). `decidePoConflict` → server-wins for app POs, refresh for external. **11 branch unit tests.**
- **`src/lib/qbo/incremental-core.ts` (server-only):** `runQboIncrementalSync` / `syncIncremental`. Delta-drains products, suppliers, movements since the connection watermark (`source_connections.last_synced_at` → the adapter's `floor` WHERE filter); writes catalog/vendor through the conflict policy touching **only QBO-owned fields** (never operator lead time / MOQ); movements append idempotently (no conflict). Logs `sync_conflicts` (auto-resolved LWW/server-wins get `resolved_at`; needs_review stays `pending`, deduped per entity so a run doesn't re-flag). Advances the watermark to the max `external_updated_at` seen.
- **`src/workflows/qbo-incremental.ts`:** `qboIncrementalSyncWorkflow` (`"use workflow"` + `"use step"`), mirrors `qbo-sync.ts`. Both cron and "Sync now" `start()` it.
- **Cron:** `src/app/api/qbo/sync/cron/route.ts` (Bearer `CRON_SECRET`; fans out one workflow per active connection) + `vercel.json` `*/15 * * * *`. **NOTE: chose `vercel.json` over the contract's `vercel.ts` to avoid adding the `@vercel/config` dependency — functionally identical for a cron declaration.**
- **Action + reader:** `runQboIncrementalSync` (owner/manager gate, pre-creates the sync_run, returns a tracking key) + `getQboIncrementalResult` poller.
- **UI:** `IncrementalSyncControls` on the connected QBO panel — "Last synced X · auto-syncs every 15 minutes", a **Sync now** delta button with a result summary (updated / new / movements / conflicts), and a **"N changes need review"** badge (the `/flow/sync-conflicts` resolution surface is Wave 6.3-C). `ConnectPanel` gains a `pendingConflicts` prop; the page counts pending `sync_conflicts` (RLS-scoped).
- **Baseline:** the initial sync now stores `external_updated_at` + the `qbo_fp` fingerprint on products/suppliers so the delta has something to diff against.

## Verification

- **Conflict policy:** 11 pure unit tests — every branch (insert / legacy-baseline / clean-refresh / LWW-remote / LWW-local / needs_review-equal / needs_review-missing / server-wins / refresh-external).
- **Engine integration test** (`tests/qbo/incremental-core.test.ts`, real local Supabase, scripted transport for exact deltas): clean refresh (remote changed, local clean → applied, no conflict); LWW (local edited + remote newer → applied remote, `accept_remote` logged); needs_review (both changed, equal clocks → local kept, pending queued, **re-run does NOT spawn a second conflict** = dedup proven); movement append (new bill line inserted).
- **Live browser** (seeded active connection + a pending conflict): connect panel renders the freshness strip "LAST SYNCED 48 min ago · auto-syncs every 15 minutes" + Sync now + the amber "1 CHANGE NEEDS REVIEW" badge. No console errors. (Live "Sync now" execution needs MG's real QBO sandbox creds — his acceptance step; the engine is proven by the integration test.) Evidence of record = a11y snapshot + DB facts (preview_screenshot doesn't persist to disk — gotcha).
- **287/287 tests**, typecheck / lint / craft clean. No DB migration (uses existing `sync_conflicts`, `external_updated_at`, `external_ids` jsonb).

## Codex round-1 (`_reviews/2026-06-09_block6_wave6_3b_incremental_sync.md`, gpt-5.4 full)

Fixed in-slice: (1) **movement counter** now counts rows actually inserted (`.select('id')`), so a replay reports 0 new movements, not a phantom batch; (2) **bad-date movements** now record to `sync_failures` (`invalid_date`) instead of a silent `continue`; (3) **movement idempotency** proven by a replay test (re-run same bill → 0 new rows + counter 0); (4) **needs_review re-flag** now UPDATEs the open pending conflict's `remote_state`/`local_state` (keeps the latest remote state instead of suppressing progression); (5) **supplier insert** resolves by `lower(name)` first and attaches the QBO id to an operator-created supplier instead of duplicating; (6) removed the unused `decidePoConflict` (PO delta is ticketed — shipping it now would be dead code). **285/285 tests.**
Ticketed / surfaced (in `_reviews/_tickets.md`): 6.3-C resolution UI + `resolveSyncConflict` + badge→link; 6.3-D webhook; PO delta + server-wins; `vercel.json` vs `vercel.ts` (MG decision); expired-token→alert (cross-cutting); receipt-revision edge cases; Playwright artifact; `CRON_SECRET` in prod env. The checkpoint is a WAVE checkpoint (6.3-B engine), not Block-6-complete.

## Deferred (ticketed)

- `/flow/sync-conflicts` resolution UI + `resolveSyncConflict` (accept_local/accept_remote/merge) — Wave 6.3-C.
- Intuit webhook trigger (`createWebhook()`, signature-verified) — Wave 6.3-D.
- PO delta refresh in incremental (POs change rarely; initial import + 6.3-A cover them).
- `CRON_SECRET` must be set in Vercel production env before the cron runs (safe default: unset → the route refuses).
