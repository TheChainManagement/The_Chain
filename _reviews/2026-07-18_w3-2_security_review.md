# W3-2 security review — 2026-07-18

## What was done

- Proved `switch_active_tenant()` rejects unauthenticated callers, requires a real target
  membership, row-locks the profile update, and leaves the old context unchanged on failure.
- Proved `my_tenant_memberships()` takes no tenant input and returns only `auth.uid()` memberships.
- Rechecked both functions for `SECURITY DEFINER`, empty `search_path`, revoked PUBLIC execution,
  and narrow authenticated grants. The final catalog probe also caught and removed Supabase's
  direct default `anon`/`service_role` ACLs; revoking `PUBLIC` alone was not sufficient.
- Hardened the Server Action so it renders the destination only after `refreshSession()` and
  `getClaims(refreshed_access_token)` prove the target tenant. Refresh failure or mismatch clears
  the local session and fails closed to sign-in.
- Added `tenant_context.switch` audit entries without exposing the prior tenant in the target
  tenant's audit row.
- Rechecked direct routes. Billing now restricts reads to owner/finance and portal launch to owner;
  QuickBooks setup requires `integrations.manage`. Nav hiding remains chrome only.
- Rescanned W3-0/W3-1 membership hierarchy, cross-tenant composite keys, last-owner locking,
  activation transactionality, and temporary credential handling. Added an HttpOnly HMAC proof so
  the replacement password cannot equal the owner-visible temporary password.

## What wasn’t done

- No production migration, deployment, production Auth mutation, or production browser probe.
- No SSO/SCIM/custom roles or multi-step approval work; those remain outside this slice.
- No automatic deletion of dormant provisional Auth identities. Cross-system deletion cannot be
  made atomic with tenant provisioning, so revocation now prefers a harmless identity with no
  membership over a race that could delete a now-shared real account.

## What can be done better

- Add a scheduled orphan-identity janitor that uses a long quarantine window and rechecks zero
  memberships and zero pending provisions immediately before deletion.
- Make provision expiry a returned terminal state instead of raising after an `expired` update;
  PostgreSQL exception rollback currently preserves `pending` while expiry still correctly denies
  activation.
- Add a browser test that deliberately disrupts token refresh during a company switch and asserts
  the fail-closed sign-in outcome.

## What was missed

- The original W3-2 action ignored session-refresh errors and could navigate under stale claims.
- `/settings/billing` loaded service-role subscription data without a direct-route role gate.
- The switch event was not audited.
- Function creation retained direct Supabase default-role ACLs even after `PUBLIC` was revoked.
- Supabase accepts a password update to the same value, so the original “replacement” check did not
  prove that the owner-visible temporary credential had actually changed.
- Revocation/create-compensation cleanup could delete an Auth user after another tenant began using
  the same identity.
