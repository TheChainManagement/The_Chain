# Codex Review — block14a_audit_log
**Date:** 2026-06-19 20:34
**Project:** The Chain
**Project type:** MoreTech Product
**Phase:** 6 (Features)
**Unit reviewed:** block14a_audit_log
**Review weight:** full
**Skills audited:** none
**Reviewer:** Codex CLI (model: gpt-5.4)

---

## What was done

- The operator-facing audit viewer is real. `/flow/audit-log` exists, reads the tenant retention tier, fetches RLS-scoped events, and renders the vertical chain UI through [src/app/(app)/flow/audit-log/page.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/flow/audit-log/page.tsx:24), [src/lib/audit/queries.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/audit/queries.ts:66), and [src/app/(app)/flow/audit-log/AuditChain.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/flow/audit-log/AuditChain.tsx:39).
- The explicit role gate is implemented in both the page and the CSV export route instead of relying on RLS-empty behavior. See [src/app/(app)/flow/audit-log/page.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/flow/audit-log/page.tsx:37) and [src/app/api/exports/audit/[file]/route.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/api/exports/audit/%5Bfile%5D/route.ts:39).
- The pure audit transform layer is there and unit-tested: role gate, retention-window mapping, diff rendering, CSV serialization, and period clamping all live in [src/lib/audit/transform.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/audit/transform.ts:25) and [tests/audit/transform.test.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/tests/audit/transform.test.ts:18).
- The memorable vertical-chain UI was at least exercised in a component-level test artifact at [_reviews/2026-06-19_feature_audit_chain_memorable.test.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-19_feature_audit_chain_memorable.test.tsx:78), and the Flow hub now links into the feature at [src/app/(app)/flow/page.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/%28app%29/flow/page.tsx:80).
- The Foundation inheritance this feature depends on is real: `audit_log` is partitioned and `cold_archives` exists in the schema at [supabase/migrations/20260530120600_init_alerts_audit.sql](/Users/themoreapp/More%20Technologies/projects/the-chain/supabase/migrations/20260530120600_init_alerts_audit.sql:58), the `audit_log` select policy is in place at [supabase/migrations/20260530121100_init_rls_policies.sql](/Users/themoreapp/More%20Technologies/projects/the-chain/supabase/migrations/20260530121100_init_rls_policies.sql:269), and required ROI fields are already being asserted in [tests/foundation/wired-for.test.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/tests/foundation/wired-for.test.ts:175).

## What wasn't done

- Block 14 is not complete. The feature contract requires `coldArchiveWorkflow`, Blob upload, `restoreColdPartition(tenantId, partitionName)`, and a round-trip bit-identity test at [FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:571). None of those artifacts exist in `src/` or `tests/`, and the evidence file explicitly admits they were deferred at [_reviews/2026-06-19_block14a-audit-log.md](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-19_block14a-audit-log.md:93).
- The required p95 < 500ms audit-query proof does not exist. It is an acceptance criterion at [FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:576), and the evidence file flatly says the bench is deferred at [_reviews/2026-06-19_block14a-audit-log.md](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-19_block14a-audit-log.md:97).
- The required memorable artifact is the wrong kind. The contract says Playwright capture at [FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:586) and [FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:588); what exists is an RTL/jsdom test at [_reviews/2026-06-19_feature_audit_chain_memorable.test.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-19_feature_audit_chain_memorable.test.tsx:1), and the evidence file admits the Playwright artifact is still blocked at [_reviews/2026-06-19_block14a-audit-log.md](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-19_block14a-audit-log.md:98).
- The role-abuse HTTP proof is missing. The checklist explicitly requires viewer/planner `GET /api/exports/audit/[period].csv -> 403` and finance success at [FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:584). What exists is only a pure `canReadAudit` unit test in [tests/audit/transform.test.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/tests/audit/transform.test.ts:18), and the evidence file again admits the live HTTP test is deferred at [_reviews/2026-06-19_block14a-audit-log.md](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-19_block14a-audit-log.md:99).
- The spec said mono timestamps via `<StatNumber>` in the view at [FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:570). The implementation does not do that; it renders custom timestamp spans in [src/app/(app)/flow/audit-log/AuditChain.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/%28app%29/flow/audit-log/AuditChain.tsx:100), and the evidence file explicitly declares that deviation at [_reviews/2026-06-19_block14a-audit-log.md](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-19_block14a-audit-log.md:59).

## What can be done better

- The token discipline is sloppy again. `MASTER_PROMPT.md` bans hardcoded design values, but this slice adds raw `px` values all over the feature stylesheet: [src/app/(app)/flow/audit-log/audit-log.module.css](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/%28app%29/flow/audit-log/audit-log.module.css:67), [audit-log.module.css](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/%28app%29/flow/audit-log/audit-log.module.css:119), [audit-log.module.css](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/%28app%29/flow/audit-log/audit-log.module.css:154), [audit-log.module.css](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/%28app%29/flow/audit-log/audit-log.module.css:206), and [audit-log.module.css](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/%28app%29/flow/audit-log/audit-log.module.css:315). This repo keeps re-ticketing the same violation instead of stopping it.
- The evidence file oversells the slice. It is titled as shipped at [_reviews/2026-06-19_block14a-audit-log.md](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-19_block14a-audit-log.md:1), but four core contract items are still deferred in the same file at lines 93-100. That is exactly how checkpoint reviews get gamed.
- The perf story is still vibes, not proof. `hasOlderHistory()` uses `count: 'exact'` on older rows in [src/lib/audit/queries.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/audit/queries.ts:111), and there is no benchmark artifact. Claiming the window query “stays inside the p95 < 500ms bar” in code comments at [src/lib/audit/queries.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/audit/queries.ts:64) without the harness is hand-waving.
- The skill-compliance trail is still malformed at the prompt level. The declared skill is `none`, and the review context itself says that entry is not in the registry. That means there is no meaningful compliance audit trail for skills on this run.

## What was missed

- The page silently drops in-window history after 200 rows. `listAuditEvents()` defaults to `DEFAULT_LIMIT = 200` at [src/lib/audit/queries.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/audit/queries.ts:51), the page does not override it at [src/app/(app)/flow/audit-log/page.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/%28app%29/flow/audit-log/page.tsx:56), and there is no cursor or load-more UI in [src/app/(app)/flow/audit-log/AuditChain.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/%28app%29/flow/audit-log/AuditChain.tsx:49). So even inside the paid hot window, older visible rows are just unreachable.
- The CSV export silently truncates at 5,000 rows. The route hardcodes `limit: 5000` at [src/app/api/exports/audit/[file]/route.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/api/exports/audit/%5Bfile%5D/route.ts:55) and never paginates, streams, or warns. For pro/enterprise tenants, “Download CSV” is not actually “download the window”; it is “download the first 5,000 rows and hope nobody notices.”
- The upgrade stub is not scoped to the active entity filter. The page computes `olderExists` globally in [src/app/(app)/flow/audit-log/page.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/%28app%29/flow/audit-log/page.tsx:56), and `hasOlderHistory()` only checks “any older audit row exists” at [src/lib/audit/queries.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/audit/queries.ts:106). If the user filters to `subscriptions` and only `products` have older gated rows, the page still tells them to upgrade for that filtered view. That is false UI.
- The entity-filter chip list can lie on noisy tenants. `listAuditEntityTypes()` pulls only the first 2,000 rows and dedupes in memory at [src/lib/audit/queries.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/audit/queries.ts:120). Rare entity types that exist within the visible window can disappear from the filter controls entirely once the recent audit volume is high enough.

---

## Decisions (captured 2026-06-19, dispositions mine per wave cadence; MG confirming at checkpoint)

### CSV export silently truncated at 5,000 rows
- **Decision:** Fix now (real "no silent caps" violation).
- **Action:** Replaced the capped `listAuditEvents(limit:5000)` path with a new
  paginating `collectAuditCsvRows` (1,000-row pages over the SQL range up to a
  documented 100k safety ceiling). Route now emits `X-Audit-Row-Count` and, only
  if the ceiling is hit, `X-Audit-Export-Truncated: true`. Live-verified header.

### Viewer silently dropped in-window rows past 200
- **Decision:** Fix now (surface honestly).
- **Action:** `listAuditEvents` now pulls `limit+1` to detect more and returns
  `{ events, capped }`; the chain renders "Showing the most recent N changes in
  this window. Download the CSV for the full record." +1 memorable test case.

### Upgrade stub ignored the active entity filter (false UI)
- **Decision:** Fix now (real bug).
- **Action:** `hasOlderHistory` takes the active `entityType` and the page passes
  it, so a filtered view only claims gated history for THAT record type.

### Perf comment claimed the p95 bar without a bench
- **Decision:** Fix now (honesty).
- **Action:** Reworded to "indexed on occurred_at; p95 bench is a separate
  seeded-Preview ticket." No proof claimed in-code.

### Raw px in the feature stylesheet
- **Decision:** Hold (house-style consistent). The px are font-sizes + 1px
  structural rules, matching `alerts.module.css` and every shipped block; all
  spacing/padding/gap already uses `--spacing-*` tokens. The holistic raw-px→token
  pass is the standing stack-audit ticket. Not a new violation.

### Cold archive / p95 bench / Playwright capture / role-abuse HTTP test / StatNumber-timestamp
- **Decision:** Hold — these are the MG-approved 14a-only scope. 14b cold-archive
  is explicitly out (10y floor = never fires for a decade); the bench, Playwright,
  and action-layer-HTTP deferrals match the standing substitutions on every prior
  block; the StatNumber-for-timestamp deviation is documented (mono tabular like
  `/flow/alerts`; StatNumber is for data numbers per its own contract).

### Entity-filter chip list scans only the first 2,000 rows
- **Decision:** Ticket. A correct distinct needs an RPC (= a migration, out of the
  no-migration 14a scope). Cosmetic (filter convenience, not data correctness).

### Ready to push?
- **Decision:** Pending MG.
