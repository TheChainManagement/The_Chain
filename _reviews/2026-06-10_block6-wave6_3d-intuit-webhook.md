# Evidence — block6_wave6_3d_intuit_webhook

**Date:** 2026-06-10
**Project:** The Chain
**Phase:** 6 (Features) · Block 6 (QuickBooks Online) · Wave 6.3-D
**Unit:** Intuit auto-webhook (signature-verified) → durable incremental sync

---

## Goal

Add Intuit's near-real-time webhook as the second trigger for the incremental sync (alongside the
15-minute cron), with mandatory signature verification per `FEATURES.md:271` + `FEATURES.md:289`.
This is the last remaining piece of the Block 6 QBO sync contract (cron + conflict policy shipped in
6.3-B, resolution cockpit in 6.3-C). After this, QBO sync is contract-complete except generated-PO
write-back, which stays blocked on the reorder engine.

## What was built

1. **Pure verify + parse** — `src/lib/qbo/webhook.ts`. `verifyIntuitSignature(rawBody, header, token)`
   computes HMAC-SHA256 over the RAW body with the verifier token and constant-time compares against
   the base64 `intuit-signature` header (length mismatch short-circuits before `timingSafeEqual`;
   never throws → caller returns a flat 401). `parseEventRealmIds(body)` pulls the distinct `realmId`s
   out of `eventNotifications`, coalescing a multi-entity burst to one sync per realm, tolerant of a
   malformed payload.

2. **Route handler** — `src/app/api/qbo/webhook/route.ts` (POST). Reads the raw body, verifies the
   signature BEFORE any processing, refuses 401 when `QBO_WEBHOOK_VERIFIER_TOKEN` is unset
   (refuse-by-default, same trust model as the cron's `CRON_SECRET`). Maps each `realmId` to the
   active QBO connection via `source_connections.external_account_id`, then fans out the SAME durable
   `qboIncrementalSyncWorkflow` the cron runs (mirrors `api/qbo/sync/cron/route.ts` exactly:
   `sync_runs` row + `start()`, failure marks the run failed). Acks 200 fast so Intuit doesn't retry.
   **Coalescing:** a connection with a sync already `running` is skipped, so a bursty webhook can't
   pile up redundant workflows. `cursor.trigger='webhook'` distinguishes the origin in `sync_runs`.

3. **No DB migration, no new required env.** The verifier token is read directly from
   `process.env.QBO_WEBHOOK_VERIFIER_TOKEN` (optional) rather than added to `qboEnv()`'s required set,
   so existing QBO paths are unaffected.

## Tests

- `tests/qbo/webhook.test.ts` (new, 10 cases): signature accepts a correctly-signed body; rejects a
  wrong-token signature, a tampered body, a missing header, an unset token (refuse-by-default), and a
  wrong-length signature (no throw); realm parsing for single / multi-dedup / numeric / empty /
  malformed payloads.
- Full suite: **315 passed / 42 files** (incl. the new `tests/qbo/resolve-action.test.ts` added in
  Codex round-1). `tsc --noEmit` clean. `biome check src` clean. `next build` clean —
  `/api/qbo/webhook` registers as a dynamic function (ƒ).

## Codex review — round 1

Full review + dispositions appended to `_reviews/2026-06-10_block6_wave6_3d_intuit_webhook.md`.
Fixed: a real resolve-action race (zero-rows-affected no-op write now detected + claim released) and
the missing action-path test (`resolve-action.test.ts`, 9 cases incl. the race). README/FEATURES
prose de-inflated. Pushed back with evidence on font-px "drift", per-segment loading/error, and route
orchestration tests (all house-consistent).

## Contract deviation (flagged)

`FEATURES.md:271` frames the webhook as Workflow DevKit `createWebhook()` at `/.well-known/...`.
Intuit posts to a single fixed URL with its own `intuit-signature` HMAC scheme, which the DevKit
per-token webhook trigger does not model. So this is an Intuit-native route handler, consistent with
how the cron is a plain route handler — the same pragmatic deviation class as the cron landing in
`vercel.json` rather than `vercel.ts` (MG-approved 2026-06-09). Noted in the route docblock + tickets.

## Production wiring (manual, not code)

- Set `QBO_WEBHOOK_VERIFIER_TOKEN` in Vercel prod env (from the Intuit app's webhook config). Until
  set, the endpoint refuses every call (401) — safe default.
- Register the webhook URL (`https://<domain>/api/qbo/webhook`) + the tracked entities in the Intuit
  developer portal.

## Follow-ups (not this wave)

- **Webhook → alert on auth failure** shares the alerts-engine ticket (no alerts row on failure yet).
- **Generated-PO write-back** still blocked on the reorder engine (Blocks 7-9).
