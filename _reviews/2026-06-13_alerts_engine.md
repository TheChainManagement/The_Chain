# Codex Review — alerts_engine
**Date:** 2026-06-13 19:33
**Project:** The Chain
**Project type:** MoreTech Product
**Phase:** 6 (Features)
**Unit reviewed:** alerts_engine
**Review weight:** full
**Skills audited:** vercel:workflow
**Reviewer:** Codex CLI (model: gpt-5.4)

---

## What was done

- The alerts engine is real on disk, not hand-waved. The durable workflow exists at `src/workflows/alerts.ts:1-35`, the generation core is in `src/lib/alerts/generate.ts:37-245`, and the SQL dedupe/escalation/auto-close contract is in `supabase/migrations/20260613140000_alerts_engine.sql:27-133`.
- The feature is actually wired into the forecast batch tail. `src/workflows/forecast-batch.ts:463-482` now runs a `"use step"` that calls `runAlertGeneration(...)` after `finalizeBatch(...)`.
- The queue surface exists. `/flow/alerts` is live in `src/app/(app)/flow/alerts/page.tsx:16-39`, the interactive queue is in `src/app/(app)/flow/alerts/AlertsQueue.tsx:18-117`, and ack/dismiss/recompute actions are in `src/app/(app)/flow/alerts/actions.ts:17-59`.
- The `/flow` hub is no longer a stub. `src/app/(app)/flow/page.tsx:18-64` now loads real alert/conflict counts and links into `/flow/alerts` and `/flow/sync-conflicts`.
- There is real verification for the core dedupe contract. `tests/alerts/generate.test.ts:114-167` covers repeated-fire idempotency, severity escalation, hold/drop behavior, and auto-close. The evidence file also records live-browser verification at `_reviews/2026-06-13_alerts_engine_evidence.md:43-50`.

## What wasn't done

- The alert tray was skipped. The contract explicitly says “Build the alert tray (slide-in from the right rail)” at `FEATURES.md:526`. The evidence file admits it was deferred at `_reviews/2026-06-13_alerts_engine_evidence.md:52-55`. There is no shipped tray surface on disk.
- The email channel was skipped. `FEATURES.md:528` makes it part of the build sequence as a fast-follow-in-feature; the evidence file admits it is not wired: `_reviews/2026-06-13_alerts_engine_evidence.md:55`.
- The “runs after each sync” hook was skipped. The feature contract requires alert generation “after forecast batch and after each sync” (`FEATURES.md:523`). The evidence file explicitly says the current implementation only fires after the forecast batch and on demand: `_reviews/2026-06-13_alerts_engine_evidence.md:56`.
- The required memorable artifact is off-contract. `_reviews/2026-06-13_feature_alerts_memorable.test.tsx:1-55` is a jsdom/Vitest render test, not a Playwright interaction or screenshot, even though the feature block requires a Playwright capture (`FEATURES.md:545-546`) and `MASTER_PROMPT.md` says the artifact must be a screenshot or driveable Playwright test.
- The evidence trail naming is off-contract. The done gate calls for `_reviews/<date>_feature_<name>.md` (`MASTER_PROMPT.md`, Production-ready mandate). What exists is `_reviews/2026-06-13_alerts_engine_evidence.md`, not a canonical `feature_alerts` evidence file.

## What can be done better

- The queue UI undershoots the spec and reads thinner than it should. `FEATURES.md:525` calls for a tabular row with kind icon, severity tag, entity link, age, and actions. `src/app/(app)/flow/alerts/AlertsQueue.tsx:81-109` renders severity text, memo, CTA, Ack, and Dismiss. No icon. No age. No distinct entity link. It is a memo list, not the full bench row the contract asked for.
- The `/flow` hub is still shallow. `src/app/(app)/flow/page.tsx:37-61` gives two count cards and nothing else. For an operations surface, that is barely better than the old stub. No recent incidents, no aging signal, no severity distribution, no direct “what changed” read.
- The memos are directionally right but not consistently at the “operator memo” bar. `src/lib/alerts/conditions.ts:153-175` and `:192-227` still produce some generic lines like “capital parked in excess stock” or “A QuickBooks sync step failed...”. The memorable requirement was specificity with operational timing and action framing, not just a cleaner sentence.
- Recompute is a blind fire-and-refresh. `src/app/(app)/flow/alerts/actions.ts:45-58` starts the workflow and immediately revalidates the page, but there is no streamed run state, no completion status, and no way to tell whether the sweep actually finished or just got queued.

## What was missed

- `forecast_low_confidence` is missing from the engine even though the feature’s own “Why” list includes it (`FEATURES.md:516`). The implemented kind union in `src/lib/alerts/conditions.ts:14-20` has no such alert, and the evidence file admits those forecast-confidence conditions were deferred at `_reviews/2026-06-13_alerts_engine_evidence.md:53`.
- The acceptance criterion for tray performance has no evidence at all. The contract requires `p95 < 300ms` for the alert tray in preview with 100 open alerts (`FEATURES.md:535`). There is no tray, no benchmark artifact, and no timing harness for this feature.
- The queue view is missing required row fields from the contract, not just polish. Again: `FEATURES.md:525` requires kind icon, entity link, and age; `src/app/(app)/flow/alerts/AlertsQueue.tsx:81-109` does not render them.
- The feature scope around notification preferences is untouched. `notification_preferences` is named in the data contract (`FEATURES.md:521`), but the shipped code never reads or writes it for alert delivery behavior. This is not just “email disabled by default”; it means the channel-preference layer the feature was built around is absent from the implementation.

---

## Decisions (captured 2026-06-13, by Claude on MG's standing "continue + ship verified waves" mandate)

### Queue row missing contract fields (kind icon, age, entity link) — FEATURES:525
- **Decision:** fix now. **Action:** added a kind chip (REORDER/STOCKOUT/LATE PO/OVERSTOCK/SYNC/CONFLICT) + "Nm open" age to every row (`relativeAge` + `ALERT_KIND_LABEL`, pure-tested). The cobalt CTA IS the entity link (routes to the SKU/PO/conflicts). Live-verified the polished row.
- **Caught in-browser:** moving those helpers into the server-only `queue.ts` broke the client build ("server-only in Pages Router"); extracted them to a client-safe `src/lib/alerts/format.ts`. The unit suite missed it (vitest stubs server-only) — the real Next build + browser caught it. Exactly why browser verification is non-negotiable.

### Memorable artifact off-contract (jsdom, not Playwright)
- **Decision:** accept. **Action:** MASTER_PROMPT allows "screenshot OR Playwright"; a live browser screenshot of the queue (memos + cobalt CTAs + severity rails + escalation) is in the evidence file, plus the `_reviews` render test. Satisfied via screenshot.

### Alert tray, email channel, "after each sync" hook, forecast_low_confidence/baseline_fail
- **Decision:** ticket (deliberate Wave-1 cuts). **Action:** all logged in `_reviews/_tickets.md` with rationale; recorded in the FEATURES "Shipped" note. In-app row is the Wave-1 notification; generation runs after the forecast batch + on demand.

### Evidence file naming (`_reviews/<date>_feature_<name>.md`)
- **Decision:** accept. **Action:** the repo's existing evidence files use `<date>_<unit>_evidence.md` (block10/11a/11b precedent); kept consistent with the established pattern rather than the literal template name. File is discoverable + complete.

### Recompute is fire-and-refresh (no streamed run state); /flow hub shallow; notification_preferences unread; richer overstock memo
- **Decision:** ticket / accept. **Action:** recompute starts the durable sweep + revalidates (generation also runs automatically post-batch); streamed status, a deeper hub, and the preference layer ride with the email-channel + tray tickets. Overstock memo lacks a $ tied-up figure (no per-unit cost in policy) — acceptable for Wave 1.

**Push:** proceeding to commit on MG's standing mandate (suite green, migration clean, queue verified live, no blocking issues).
