# Evidence — block6_wave6_3c_sync_conflicts

**Date:** 2026-06-10
**Project:** The Chain
**Phase:** 6 (Features) · Block 6 (QuickBooks Online) · Wave 6.3-C
**Unit:** `/flow/sync-conflicts` resolution cockpit + `resolveSyncConflict`

---

## Goal

Close the dead-end the 6.3-B review flagged: the "N changes need review" badge pointed
at nothing, and `resolveSyncConflict` did not exist. This wave delivers the surface and the
action so an owner/manager can adjudicate `needs_review` conflicts the incremental sync queues,
per `FEATURES.md:272` and the `resolveSyncConflict accept_local / accept_remote / merge`
acceptance criterion at `FEATURES.md:288`. Scope note: conflicts logged AFTER this wave's
state-widening carry the full field set and resolve cleanly; the `warn`-alert-on-needs_review
half of `FEATURES.md:288` is detection-path scope, deferred to the alerts engine wave (see
follow-ups + the Codex round-1 dispositions below).

## What was built

1. **Widened stored conflict state** — `incremental-core.ts` now logs the full QBO-owned field
   set in `local_state` / `remote_state` (product: name/description/unit/status; supplier:
   name/status/contact), not just `{name, status}`. Without this the cockpit could not apply
   `accept_remote` / `merge` without re-pulling from QBO. The stored shapes match the sync's
   fingerprint inputs exactly, so a recomputed `remoteStateFingerprint` equals the next pull's
   `incomingFp` for an unchanged remote.

2. **Pure resolution planner** — `src/lib/qbo/resolve.ts`. `planConflictResolution()` returns the
   entity columns to write (null for accept_local), the fingerprint to stamp, and the recorded
   resolution. Mirrors the pure-core pattern of `conflict.ts`. **Key invariant:** every resolution
   stamps `external_ids.qbo_fp = fingerprint(remote_state)` — the adjudicated remote becomes the
   new baseline, so the same remote change never re-flags. Only a genuinely new remote change
   re-opens the question.

3. **Conflict queries + diff** — `src/lib/qbo/conflicts.ts`. RLS-scoped `listPendingConflicts()`,
   enriched with product SKU (one batched query), shaped into a per-field local-vs-remote diff.

4. **`resolveSyncConflict` Server Action** — `src/app/(app)/flow/sync-conflicts/actions.ts`.
   Owner/manager gate (same pattern as `runQboIncrementalSync`); loads the conflict tenant-scoped;
   rejects already-resolved / unknown-entity / missing-link rows; runs the planner; writes the
   entity (preserving existing `external_ids`, stamping the fp); marks the conflict resolved with
   `resolved_by_user_id` + `resolved_at`; revalidates the cockpit, QBO, and the affected list.

5. **Cockpit** — `page.tsx` (server, RLS-scoped, PPR like every (app) page) + `ConflictCockpit.tsx`
   (client) + `sync-conflicts.module.css`. The **reconciliation bench**: YOUR RECORD vs QUICKBOOKS,
   differing fields cream-washed, three actions (Keep yours / Take QuickBooks / Merge). Merge mode
   makes each differing cell pickable; the chosen value lights cobalt (the single intent slot). On
   resolve, the two columns converge into one settled cobalt chain link (RECONCILED) before the row
   clears. Empty state when nothing is pending.

6. **Badge wired** — `IncrementalSyncControls.tsx` "N changes need review" is now a `Link` to
   `/flow/sync-conflicts` with a "Resolve →" affordance. The dead-end is gone.

## Tests

- `tests/qbo/resolve.test.ts` (new): fingerprint parity with the sync; accept_local (no write +
  stamp); accept_remote (full column map, incl. supplier contact); merge (operator blend + remote
  baseline stamp); merge guards (no payload / missing field throw); `toEntityColumns` null-coercion.
- `_reviews/2026-06-10_feature_sync_conflicts_memorable.test.tsx` (new, runs in CI via the
  `_reviews/**/*_memorable.test.tsx` glob): drives the real `ConflictCockpit` through diff →
  merge-pick (cobalt selection flips, non-differing cells stay neutral) → resolve, asserting the
  Server Action is called with the object-arg shape + the operator's per-field merge payload, and
  the RECONCILED beat renders.
- Full suite: **296 passed / 40 files**. `tsc --noEmit` clean. `biome check src` clean.
  `next build` clean — `/flow/sync-conflicts` renders as PPR.

## Visible artifact

Added a "SYNC CONFLICTS — reconciliation bench + resolved state" section to the dev/CI `/gallery`
(the project's sanctioned visible-craft screenshot path, fixtures only, 404 in prod). Captured via
Preview MCP at `localhost:3100/gallery`:
- **Default state** — both benches with the diff, "2 FIELDS DIFFER" tag, three actions.
- **Merge state** — differing cells pickable, chosen value (Galvanized Joist Hanger 2x10 / box of 25)
  lit cobalt; non-differing rows neutral.
- **Resolved state** — settled cobalt chain link "RECONCILED · Merged field by field".

A CSS specificity bug found during capture (the differing-row cream wash out-specified the cobalt
chosen rule, hiding the selection) was fixed by scoping the chosen/hover rules under
`.fieldRow[data-differs]`.

## Known follow-ups (not this wave)

- **Webhook** (Intuit auto-trigger) remains a separate Block 6 wave.
- **Legacy conflict rows** logged before the state-widening (pre-launch dev data only) carry the
  thin `{name,status}` shape; the planner handles missing keys as null, but their re-stamped fp may
  differ from a full pull. Non-issue pre-launch (no real tenants); a fresh sync re-logs them widened.
- **PO conflicts** (server-wins) still deferred until the reorder engine generates POs (Blocks 7-9).

## Codex review — round 1 (2026-06-10)

Full review at `_reviews/2026-06-10_block6_wave6_3c_sync_conflicts.md` (Codex CLI, gpt-5.4).
Fixed in this slice:

- **Resolution write was not atomic** (real consistency bug) → `resolveSyncConflict` now CLAIMS the
  conflict with a compare-and-set on `applied_resolution='pending'` BEFORE mutating the catalog; if
  the entity write fails it releases the claim. A concurrent resolve / double-submit can no longer
  double-apply.
- **Server Action used positional args** vs the `MASTER_PROMPT.md:124` `(input) => Promise<...>`
  shape → refactored to a single `ResolveConflictInput` object; caller + test updated.
- **Motion values hardcoded** (`140ms`, `700ms`, the spring cubic, `1100ms`) → swapped to the
  `--duration-*` / `--ease-*` tokens (`ignite` now uses `--ease-spring-soft`, which is the exact
  cubic that was inlined).
- **Focus on the cobalt-chosen cell** → the global `:focus-visible` cobalt ring covers neutral
  cells/links; added a deep-slate ring override for the cobalt-on-cobalt chosen cell per the
  doctrine. (Codex's broader "no focus styling" was largely covered by the global rule.)
- **No action-/UI-level test** → added the memorable RTL test above (drives the real component +
  asserts the merge payload). README "conflict-resolution UI is Next" line corrected.

Deferred (dispositions pending MG):

- **`warn` alert on `needs_review`** (`FEATURES.md:288`) — detection-path scope; the alerts engine
  has dedupe / severity-rise logic, so a naive insert here would fight it. Ticket to the alerts wave.
- **PO server-wins branch test** — no app-generated POs exist until the reorder engine (Blocks 7-9);
  `decidePoConflict` stays an unused pure helper until then. Out of scope.
- **Real-route E2E** (auth + live Supabase + real action) — the gallery/RTL artifacts prove the
  component + the action contract; full end-to-end belongs in Phase 7.
