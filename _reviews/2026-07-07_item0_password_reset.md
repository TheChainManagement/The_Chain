# Codex Review — item0_password_reset
**Date:** 2026-07-07 20:41
**Project:** The Chain
**Project type:** MoreTech Product
**Phase:** 6 (Features)
**Unit reviewed:** item0_password_reset
**Review weight:** full
**Skills audited:** (none)
**Reviewer:** Codex CLI (model: gpt-5.4)

---

## What was done

- The password-reset slice exists on disk: request action, update action, reset forms, `/forgot-password`, `/reset-password`, `/api/auth/confirm`, sign-in link, CSS, and tests.
- `src/app/(auth)/actions.ts:97-118` sends Supabase reset emails with a redirect to `/api/auth/confirm?next=/reset-password`.
- `src/app/api/auth/confirm/route.ts:26-44` handles both `token_hash` and PKCE `code` link shapes and guards `next` against external redirects.
- `src/app/(auth)/actions.ts:120-173` validates the new password, calls `updateUser`, tries to write `auth.password_reset`, and redirects to `/today`.
- `tests/auth/password-reset.test.ts:80-202` covers the main action and confirm-route paths.
- Evidence exists at `_reviews/2026-07-07_item0_password_reset_evidence.md`.

## What wasn't done

- Production acceptance is not actually delivered. The stated acceptance is production recovery without MG touching the DB, but the evidence says production still needs Supabase redirect URL configuration and preferably an email-template change: `_reviews/2026-07-07_item0_password_reset_evidence.md:62-78`.
- The screenshot gate is still not satisfied by an artifact on disk. The evidence admits screenshots were only viewed inline and did not persist: `_reviews/2026-07-07_item0_password_reset_evidence.md:50-53`.
- The kickoff status points to the wrong evidence filename. `docs/NEXT_SESSION_KICKOFF_PROMPT.md:256` references `_reviews/2026-07-07_item0_password_reset.md`, but the file on disk is `_reviews/2026-07-07_item0_password_reset_evidence.md`.
- No skills were declared invoked, so there is no skill artifact trail to audit.

## What can be done better

- `requestOrigin()` trusts forwarded host headers to build the reset URL: `src/app/(auth)/actions.ts:90-94`. That is fragile for auth email links. Use a configured public app URL or a strict allowed-host resolver. The test only locks in the happy-path forwarded host: `tests/auth/password-reset.test.ts:51-52`.
- `/api/auth/confirm` accepts any `type` value and casts it to `EmailOtpType`: `src/app/api/auth/confirm/route.ts:28-36`. This route is for password recovery. It should reject anything except `recovery`, otherwise other Supabase email token types can be consumed by the reset endpoint.
- Audit write failures are not really observed. The insert result is ignored at `src/app/(auth)/actions.ts:160-167`; only thrown exceptions hit the `catch`. A Supabase `{ error }` response silently loses the audit row, despite the evidence claiming audit logging.
- The sign-in footer is getting cramped: `src/app/(auth)/signin/page.tsx:23-32` now combines account creation and password reset into one sentence. It works, but this is a brittle place to keep stacking auth links.

## What was missed

- The reset flow is still dependent on out-of-repo Supabase Auth settings. That is not a small note; it is the difference between “works locally” and the production acceptance criterion.
- The route-level tests mock Supabase and Next behavior heavily, so they do not prove session cookie persistence from `verifyOtp` or `exchangeCodeForSession`. The evidence claims a live probe covered this, but there is no durable executable artifact for that path.
- The audit requirement is weaker than claimed. Tenantless accounts skip audit entirely, profile lookup errors are ignored, and insert errors are ignored. If “audit-log the reset event” is a requirement, this implementation treats it as optional telemetry.
- The evidence trail drifted during the rename. That is exactly the kind of review artifact mismatch that makes later checkpoint work unreliable.

---

## Decisions (captured 2026-07-07, by Claude at MG's standing "fix the clear bugs" bar)

Note the review header says model gpt-5.4 but the run actually used gpt-5.5 (the account no
longer supports 5.4; the header string is a script default, not the model invoked).

### Confirm route accepts any `type` and casts to EmailOtpType (What can be done better #2)
- **Decision:** Fix now. A reset endpoint must not consume other Supabase email-token types.
- **Action:** `/api/auth/confirm` now requires `type === 'recovery'`; else it bounces to the
  expired notice. +1 test (`rejects a non-recovery token type`).

### requestOrigin trusts spoofable forwarded-host headers (What can be done better #1)
- **Decision:** Fix now.
- **Action:** `requestOrigin()` prefers `NEXT_PUBLIC_SITE_URL` → `VERCEL_PROJECT_PRODUCTION_URL`
  (trusted) and only falls back to headers for local dev. +1 precedence test. Deploy note 3 added.

### Audit insert / profile errors ignored (What can be done better #3, What was missed #3)
- **Decision:** Fix now (observe, don't swallow) — keep it best-effort so a broken audit path
  never locks a user out, but log the failure.
- **Action:** Both the profile-lookup `{ error }` and the insert `{ error }` are now checked and
  `console.error`-logged. +2 tests (reset completes on each failure). The audit stays
  intentionally best-effort and tenantless accounts still skip it (they have no tenant to key on);
  that is by design for the recovery path, documented in the evidence file.

### Kickoff status points to the wrong evidence filename (What wasn't done #3)
- **Decision:** Fix now.
- **Action:** Status line now names `_evidence.md` (build evidence) and this Codex file separately.

### Screenshot artifact + live cookie-persistence executable test (What wasn't done #2, What was missed #2)
- **Decision:** Accept / standing infra ticket. Same Playwright-harness gap carried across every
  prior block. The live browser probe against real Supabase (real recovery token → new-password
  sign-in confirmed) plus the RTL-style tests are the standing substitution.
- **Action:** Recorded in the evidence file's deferred list. No new work this slice.

### Production depends on out-of-repo Supabase Auth settings (What wasn't done #1, What was missed #1)
- **Decision:** Accept. Inherent to any Supabase reset flow, not a code gap. Captured as deploy
  notes 1–2 for MG's push.
- **Action:** No code change; deploy notes stand.

### Sign-in footer getting cramped (What can be done better #4)
- **Decision:** Accept as-is for now (one extra link is fine); revisit if a third auth link lands.
- **Action:** None.

All "fix now" items are complete: suite 717/717, tsc/biome/craft clean. Awaiting MG's explicit
"push" before pushing `feature/item0-password-reset`.
