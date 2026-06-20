# Block 14a — Audit-Log Viewer

Date: 2026-06-19
Scope: Wave 14a (operator-facing viewer). Wave 14b (cold archive) ticketed, not built.

## What shipped

The `/flow/audit-log` viewer — the operator surface over the append-only audit
trail that Foundation triggers have been writing since day one. Read-only; every
audit row is system-written by the trigger dispatcher.

**Memorable element:** the audit trail renders as a continuous vertical **chain
of events** — a 1px hairline spine threads top to bottom, a node sits on the
spine per change, and today's entries carry a **filled deep-slate node** (the
"you are here" marker; past entries get a hollow ring). Each link is a typeset
block (mono timestamp · verb + entity · actor) that **expands its before/after
field diff inline on click**. Same chain metaphor as the PO lifecycle, turned
vertical and made the record.

### Files
- `src/lib/audit/transform.ts` — pure: the role gate (`canReadAudit`), tier→hot-
  window mapping (`RETENTION_WINDOW_DAYS`, `tierWindowCutoffIso`, label), entity
  labels, action→verb, `diffFields` (insert=added / delete=removed / update=only
  changed keys; secret denylist), CSV serializer, export period clamping.
- `src/lib/audit/queries.ts` — server-only: `listAuditEvents` (RLS-scoped,
  cutoff + entity filter in SQL), `hasOlderHistory`, `listAuditEntityTypes`,
  `getRetentionTier`.
- `src/app/(app)/flow/audit-log/page.tsx` — server shell, explicit role gate.
- `src/app/(app)/flow/audit-log/AuditChain.tsx` — the client chain + diff + filter.
- `src/app/(app)/flow/audit-log/audit-log.module.css`
- `src/app/api/exports/audit/[file]/route.ts` — CSV export, explicit 403 gate.
- `src/app/(app)/flow/page.tsx` — added the Audit log card to the Flow hub.
- Tests: `tests/audit/transform.test.ts` (27 cases) + memorable artifact
  `_reviews/2026-06-19_feature_audit_chain_memorable.test.tsx`.

## Decisions (flag for MG / Codex)

1. **Tier → hot window (locks with pricing):** free=14d (trial length),
   starter=1y, standard=5y, pro=10y, enterprise=unlimited. Per FEATURES; the
   exact spans move with zero partition movement (rows never leave the table).
2. **Retention tier read via the ADMIN client, not RLS.** The `subscriptions`
   SELECT policy is **owner/finance only**, but `audit_log` is owner/manager/
   **finance** — so a manager viewing the trail can't RLS-read their own tier.
   The page is already role-gated; tier isn't sensitive; resolved with an
   explicit tenant filter on the admin client. Defaults to 'free' (tightest) on
   a read miss so a miss never widens visibility.
3. **Explicit 403 in the export route**, not RLS-empty. RLS would hand a
   viewer/planner an empty 200; the acceptance bar is a 403, so the route checks
   the JWT role via the same `canReadAudit` the page uses (one gate, no drift).
4. **Actor shown as You / System / Teammate (+ short id), never email.** The
   audit row holds only `actor_user_id`; resolving an email would ADD PII not in
   the source row, against the "no PII beyond the source row" checklist.
5. **The dispatcher tracks ~30 tables, not the 13 FEATURES names.** Real data
   surfaced sync_runs, locations, po_receipt_events, forecasts, alerts, etc.
   Expanded `ENTITY_LABEL` to cover all observed; the long tail humanizes.
6. **Non-standard action strings handled:** `tenant.created` (past tense) and
   `onboarding.seed_only_bypass` (custom). `actionVerb` maps created/updated/
   deleted; unknown verbs read "Changed".
7. **Timestamps render in font-mono tabular (UTC), not `<StatNumber>`.** Matches
   how `/flow/alerts` renders its ages; StatNumber is reserved for data numbers
   per its own contract. StatNumber IS used for the header event count.

## Verification

- typecheck clean · biome clean · `next build` clean (`/flow/audit-log` = ◐ PPR;
  `/api/exports/audit/[file]` route present).
- **Full suite 638/638** (was 612; +26 audit transform/memorable, +1 from the
  polish pass for past-tense verbs).
- craft check: only failure is a **pre-existing false-positive** in the untouched
  PO export route (a `#301` in a comment reads as hex). My files pass.

### Live (dev :3100, throwaway owner tenant `audit-verify@thechain.test`, "Ledger Audit Co")
Fresh signup wrote real audit rows via the bootstrap + triggers. Verified:
- Viewer renders the vertical chain, **3 real entries** (Created Workspace /
  Subscription / Team member), all today → **filled deep-slate nodes**.
- StatNumber "EVENTS 3", window "Trial period" (free tier), filter chips All /
  Subscription / Team member / Workspace.
- **Expand-on-click** opens the diff: Created Workspace → `name: Ledger Audit Co`,
  `owner: c69d07ac…`, `slug: ledger-audit-co-d18e39` (added values in flow-green).
- **Entity filter** `?entity=subscriptions` → 1 entry, only Subscription, chip
  active, count updates to 1.
- **CSV export** `/api/exports/audit/window.csv` → 200, `text/csv; charset=utf-8`,
  `attachment; filename="audit-window.csv"`, header row + 3 data rows.
- Zero console errors.
- Screenshot captured (chain + expanded diff). Note: per the standing gotcha,
  `preview_screenshot` returns inline only, not to disk — DOM/CSV/DB facts above
  are the evidence of record.

Dev-compile gotcha hit again: the client island didn't hydrate until Turbopack
finished compiling the route chunk (clicks were inert on first paint). Re-nav +
wait fixed it; build + tests are the authoritative signal, not first-paint.

## Deferred → `_reviews/_tickets.md`
- **Wave 14b (cold archive):** `coldArchiveWorkflow` daily cron, Vercel Blob
  upload, `cold_archives` table, `restoreColdPartition` — retention floor is 10y
  so nothing detaches for a decade; pure correctness-plumbing, no visible value.
- p95 < 500ms bench for 12mo history (seeded-Preview harness, like other blocks).
- Playwright vertical-chain capture (infra-blocked, same as every block).
- Role-abuse 403 as a live HTTP test (unit-covered via `canReadAudit` + explicit
  route gate; full HTTP role-switch needs a seeded non-privileged session).
- Pagination / load-more beyond the 200-row window cap.

## Codex round-1 (2026-06-19) — applied in-slice
Full Phase-6 gpt-5.4 pass (`_reviews/2026-06-19_block14a_audit_log.md` + Decisions).
Four real findings fixed in-slice, the rest held with precedent / ticketed:
- **CSV no longer silently truncates** — paginating `collectAuditCsvRows` over the
  full SQL range (1k pages, 100k documented ceiling), `X-Audit-Row-Count` +
  `X-Audit-Export-Truncated` headers. Live-verified header on the 3-row export.
- **Viewer 200-cap surfaced honestly** — `{ events, capped }`; "Showing the most
  recent N… download the CSV" caption + memorable test case.
- **Upgrade stub scoped to the active entity filter** — `hasOlderHistory(entityType)`.
- **Perf comment de-claimed** — no in-code p95 assertion without the bench.
Held: raw-px (house-style, matches alerts + every block; stack-audit ticket), and
the MG-approved 14a-scope deferrals (14b, p95 bench, Playwright, role-HTTP test,
StatNumber-timestamp). Ticketed: entity-filter 2k-row scan (needs an RPC).
Suite **640/640**, tsc/biome/`next build` clean. Re-verified live (page renders,
CSV 200 w/ row-count header) after the refactor.
