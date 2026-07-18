# Wave 3 role-spine design audit (2026-07-16)

Branch: `codex/w3-role-spine`

Design source: `docs/WAVE3_W3-0_ROLE_SPINE_DESIGN.md`

## Verified merged baseline

- `main` and `origin/main` were clean at `362137d`.
- W2-4 commit `026c4ef` is an ancestor of merged `main`; the location boundary is available to
  Wave 3.
- The versioned re-award fast-follow is merged (`60658dd` + `362137d`).

## Existing role foundation verified

- `member_role` has owner, manager, planner, warehouse, finance, and viewer.
- `tenant_members` stores role and optional department.
- the access-token hook emits verified `tenant_id`, `tenant_role`, and `token_generation` only
  when the active membership exists;
- `is_token_stale()` is called from the session-refresh proxy and role/removal changes bump the
  tenant generation;
- role-aware RLS and action gates already exist across planning, procurement, warehouse,
  transfers, billing, and audit;
- the inventory posting kernel remains the sole balance mutation path.

## Activation gaps found

1. No provisional-account, temporary credential, expiry, activation, revoke, or rotation model.
2. Direct manager writes to `tenant_members` can grant roles without a hierarchy guard.
3. No database last-owner invariant.
4. No Team settings surface.
5. The documented active-tenant switch action and UI do not exist.
6. No per-member location assignment or database `can_access_location` boundary.
7. The shared S&OP number has never been defined.

The schema scan found the location dimension across inventory, movement, forecast, policy,
recommendation, PO, count, RFQ, requisition, and transfer records. W3-3 therefore needs a deliberate
policy/RPC rollout, not an app-only filter.

## Design disposition

- Add a provisional-account table and guarded membership RPCs; the temporary password is generated
  by the auth service, revealed once, and never stored in readable application state.
- Tighten raw membership mutation policies after RPC coverage exists.
- Preserve current behavior by backfilling existing members to all-location access.
- Enforce scoped locations through PostgreSQL helpers and RLS/RPC checks.
- Keep one app and one capability registry; role-aware views compose the same business data.
- Recommend 30-day demand coverage as the common planning number.

## Gate

No schema or product code was changed in this design pass.

## MG decision addendum (2026-07-17)

- Owner-created provisional accounts with a system-generated temporary password replace the
  copy-link invitation recommendation. The provisional account receives no tenant membership or
  tenant claims until forced password replacement and activation.
- Owners manage every role; managers manage lower roles only; final-owner safeguards remain.
- Database-enforced location assignments ship in Wave 3.
- The shared planning number is 30-day demand coverage.
- The default requisition flow remains higher-approver, independent of amount. Owners may configure
  a member for always-require-approval, automatic approval up to a spend limit, or unlimited
  automatic approval. Qualifying requests are approved by the system from the owner-delegated
  policy, with the evaluated limit/total/reason audited. Above-limit requests enter the approver
  queue; approver authority limits are separately owner-configurable.

All Wave 3 design decisions are now locked; W3-0 through W3-5 are unblocked in sequence.

## W3-0 implementation evidence (2026-07-17)

- Added the shared six-role capability registry in `src/lib/access/`, including role labels,
  capability checks, role-management hierarchy, navigation visibility contract, and daily-bench
  emphasis.
- Dropped authenticated direct insert/update/delete policies on `tenant_members`. Signup and
  maintenance retain their privileged paths; application membership mutations now use guarded
  functions.
- Added tenant-locked `change_tenant_member_role()` and `remove_tenant_member()` functions. Owners
  manage other roles, managers manage lower roles only, self-change/removal is blocked, cross-tenant
  calls fail, and removal clears matching active-tenant profile state atomically.
- Owner-count decisions serialize on the tenant row so concurrent owner mutations cannot both act
  on a stale count. The existing generation trigger invalidates role/removal claims.
- Added database probes for owner/manager hierarchy, privileged-role escalation, self mutation,
  cross-tenant access, active-tenant cleanup, idempotent removal, direct-write closure, and token
  generation. Existing role-matrix, claim-integrity, and live PostgREST auth regressions remain green.
- Gate: clean `supabase db reset`; 129 Vitest files and 928 tests passed; `npm run build`,
  `npm run lint`, `npm run typecheck`, and `npm run check:craft` passed.

## W3-1 implementation evidence (2026-07-17)

- Added `tenant_access_provisions` with pending/activated/revoked/expired state, one-pending-email
  uniqueness, credential expiry, server-only password-replacement proof, RLS, and full audit
  capture. Temporary passwords are generated cryptographically in the server action, returned
  once, and never stored in application tables or audit snapshots.
- Added guarded create, rotate, revoke, inspect, and activate functions. The management functions
  re-check the actor's real membership and enforce owner/manager hierarchy; activation validates
  the authenticated Auth user and email before atomically creating the membership and active
  tenant profile state.
- New Auth users receive no membership or tenant claims until the temporary password is replaced.
  Existing Chain users keep their password and activate the additional company through the same
  entrance. Expired credentials cannot activate, and direct bench navigation remains closed.
- Added `/settings/team` with role-aware account creation, one-time credential display/copy,
  temporary-password rotation, revocation, active-member role changes, and removal. Added
  `/activate-account` and provisional-first sign-in routing.
- Database probes cover staged isolation, manager privilege rejection, password-proof bypass,
  atomic activation, existing-user activation, expiry, rotation, revocation, and secret-free
  audit. Component probes cover one-time credential display/copy behavior.
- Live local-browser verification created a provisional planner, observed the one-time credential,
  signed in with it, reached the forced replacement page, and confirmed `/today` rejects the user
  before activation. Browser console remained clean. The final password submission was left to the
  database lifecycle probe.
- Gate: clean migration replay; 132 Vitest files and 940 tests passed; production build,
  TypeScript, Biome, and craft guard are green.
