# Item 0: Password reset / auth recovery — build evidence (2026-07-07)

Branch: `feature/item0-password-reset` (not pushed; awaiting MG review per the gate).
Scope source: `docs/NEXT_SESSION_KICKOFF_PROMPT.md` Item 0. Live-customer-critical carry-over
from `docs/WAVE2_SCOPE.md` §4.

## What was built

- **`/forgot-password`** — request form in the (auth) segment styling ("Locked out of the
  workshop?"). Enumeration-safe: the confirmation copy never reveals whether the email matched
  an account. Rate-limit errors from Supabase are the one failure surfaced honestly. Shows an
  expired-link notice when bounced back from a dead link.
- **`/api/auth/confirm`** — the route the recovery email lands on. Accepts BOTH link shapes:
  `token_hash` + `type` (verifyOtp, works cross-browser) and `code` (PKCE exchange, same-browser).
  On success it sets the session cookie and forwards to `next`; on failure it bounces to
  `/forgot-password?error=expired`. `next` is confined to same-origin paths (open-redirect guard).
- **`/reset-password`** — set-a-new-password form, rendered only under the recovery session
  (no session bounces to the request form). Validates length (6+, matching signup) and
  confirmation match. On success: password updated, recovery audit-logged, user lands on /today.
- **Audit:** `auth.password_reset` row written via the admin client (audit_log is system-write
  only), tenant resolved from `profiles.active_tenant_id`. Best-effort by design: an audit
  write failure logs to console but never blocks the recovery (a tenantless account skips it).
- **Sign-in page** now carries a "Forgot your password? Reset it" link.
- Pages follow the repo's Suspense-wrapper convention (sync page, async inner) so the
  blocking-route dev check stays quiet.

Files: `src/app/(auth)/actions.ts` (requestPasswordReset, updatePassword),
`src/app/(auth)/ResetForms.tsx`, `src/app/(auth)/forgot-password/page.tsx`,
`src/app/(auth)/reset-password/page.tsx`, `src/app/api/auth/confirm/route.ts`,
`src/app/(auth)/signin/page.tsx`, `src/app/(auth)/auth.module.css`,
`tests/auth/password-reset.test.ts`.

## Live verification (dev server, real Supabase)

Ran the acceptance loop end to end against the real Supabase project with a throwaway auth
user (`item0-reset-probe@moretechnologies.com`, NO tenant graph, deleted afterward):

1. Created the probe user (old password) + minted a real recovery `token_hash` via the admin API.
2. Opened `/api/auth/confirm?token_hash=...&type=recovery&next=/reset-password` in the browser
   → 307 → `/reset-password` rendered the form addressed to the probe email.
3. Submitted `NewProbePassword1` → redirect to `/today` → (app) layout bounced the tenantless
   probe to `/signin` (expected; real users carry a tenant claim).
4. `signInWithPassword` with the NEW password → OK. The reset provably took.
5. Probe user deleted; temp script removed.

Also verified live: the sent-confirmation state after requesting a reset for an arbitrary
email (enumeration-safe copy), the expired notice via a bogus token bounce, `/reset-password`
with no session bounces to the request form, and the new sign-in link.

Screenshot note: captured in-session via the preview browser (request form, sent state,
reset form with probe email, sign-in with the new link). The preview screenshot tool still
does not persist to disk in this env (standing Playwright-harness ticket), so this run log +
the RTL-style action tests are the durable artifacts, per the standing substitution.

## Checks

- `tests/auth/password-reset.test.ts`: 15 cases (request validation, enumeration safety,
  rate-limit surfacing, update validation, fail-closed without session, audit write + skip,
  Supabase error mapping, confirm-route token_hash / code / failure / open-redirect paths).
- Full suite 713/713. `tsc --noEmit` clean. `biome check src` clean. Craft guard PASS.

## Production deploy notes (for MG's go)

1. **Supabase Auth URL configuration:** add `https://thechainmanagement.com/api/auth/confirm`
   to the Redirect URLs allow list (Auth → URL Configuration). Without it,
   `resetPasswordForEmail`'s redirectTo is ignored and the link falls back to the Site URL.
2. **Recommended (cross-browser reliability):** point the "Reset Password" email template at
   `{{ .SiteURL }}/api/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password`
   so the link verifies server-side via token_hash and works even when opened in a different
   browser than the one that requested it. The default `{{ .ConfirmationURL }}` shape also
   works (the route handles the `code` param) but is same-browser only.
3. No migration, no env var, no RLS change in this slice.

## Acceptance vs the kickoff doc

"A user who forgot their password can recover the account end to end on production without MG
touching the database." Proven end to end on dev against the real auth backend; production
needs the deploy notes above plus the normal push-on-MG's-go.
