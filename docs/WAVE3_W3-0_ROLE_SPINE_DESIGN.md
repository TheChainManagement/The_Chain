# The Chain: Wave 3 Role Spine + Shared Plan Design

*Drafted 2026-07-16 for MG sign-off before implementation. Sources: the original Wave 3
roadmap in `docs/WAVE2_SCOPE.md`, the identity and RLS contracts in `SYSTEM_DESIGN.md`,
the shipped W2-4 location boundary, and a fresh code/schema audit on merged `main` at
`362137d`.*

*Status: **SIGNED OFF 2026-07-17.** All decisions in §11 are locked. W3-0 access-spine
hardening and W3-1 provisional accounts/team bench are built on `codex/w3-role-spine`;
W3-2 tenant switching and role-aware chrome are next.*

## 1. Outcome

Wave 3 turns the single-owner workshop into a real operating team without weakening the
tenant and location boundaries already shipped.

An owner can invite coworkers, assign a role, optionally fence operational users to specific
locations, and safely change or remove access. Every member sees the same underlying business
truth, but their daily bench emphasizes the work their role owns. A lightweight shared planning
surface gives everyone one agreed demand-coverage number instead of separate departmental
spreadsheets.

This is a role activation wave, not a generic enterprise IAM build. SSO/SAML, SCIM, custom roles,
approval chains, and workforce scheduling remain outside the slice.

## 2. Audit: what is already real

The foundation anticipated this wave well:

- `member_role` already defines `owner`, `manager`, `planner`, `warehouse`, `finance`, and
  `viewer`.
- `tenant_members` already stores the role and optional department.
- the access-token hook emits verified `tenant_id`, `tenant_role`, and `token_generation`
  claims only for a real active membership;
- middleware rejects stale role/removal claims;
- the RLS matrix already gates most role-specific writes;
- physical stock Server Actions already allow owner/manager/warehouse, planning and procurement
  actions already allow owner/manager/planner, and billing/audit reads already recognize finance;
- W2-4 made location an explicit read and write boundary.

No role enum rewrite or tenant-model replacement is needed.

## 3. Audit: gaps that block safe activation

The role rows exist, but the product cannot safely expose them yet:

1. **No provisional-account lifecycle.** A `tenant_members` row requires an `auth.users` row, but
   there is no owner-created account, temporary credential, forced password replacement, expiry,
   activation, or cancel model.
2. **Unsafe raw role mutation.** Current RLS lets managers insert/update `tenant_members`. It does
   not prevent a manager from granting `owner`, promoting themselves, or demoting the last owner.
3. **No last-owner invariant.** The tenant can be left with nobody able to administer it.
4. **No team surface.** Settings cannot list members, pending provisions, roles, or access.
5. **No tenant switcher.** The auth design documents `active_tenant_id`, but the action and UI do
   not exist. A person added to a second tenant has no clean way to enter it.
6. **No per-location membership.** W2-4 deliberately deferred location assignments to Wave 3.
   URL scope is not authorization; current tenant-wide reads include every tenant location.
7. **No role-aware bench composition.** Action gates exist, but every role gets essentially the
   owner navigation and `/today` hierarchy.
8. **The S&OP promise is still undefined.** “One number everyone reads” needs a precise formula,
   time horizon, refresh rule, and drill-down before UI work.

These gaps require additive tables and guarded RPCs. That is not a foundation rewrite; it is the
missing activation layer over the existing role spine.

## 4. Principle: capabilities, not six separate products

Keep one application and one source of truth. A role changes:

- which actions are authorized;
- which locations are visible;
- which navigation is emphasized or hidden;
- which daily queue appears first.

It does not create separate schemas, duplicate dashboards, or role-named copies of business
logic. All decisions route through a shared capability registry so navigation, Server Actions,
and tests cannot invent conflicting role rules.

Suggested registry: `src/lib/access/` with role labels, descriptions, capabilities, allowed
navigation, default landing emphasis, and location-access behavior. PostgreSQL RLS and guarded
RPCs remain the authorization boundary; the registry is the visible/friendly mirror.

## 5. Membership and provisional-account model

### 5.1 Owner-created provisional accounts

Add tenant-scoped `tenant_access_provisions`:

- `id`, `tenant_id`, normalized `email` (`citext`), proposed `role`, optional `department_id`;
- `auth_user_id` after the auth account is created;
- `status`: `pending_password_change`, `activated`, `revoked`, `expired`;
- `credential_expires_at`, `created_by_user_id`, `activated_at`, created/updated timestamps;
- unique active provision per tenant + email;
- tenant RLS, audit trigger, and cross-tenant probes.

The owner enters the coworker's email and role. The server creates the auth account with a
cryptographically random temporary password and returns that password to the owner exactly once.
The owner communicates the email and temporary password through their normal company channel.
The password is system-generated, never owner-chosen, never stored in application tables, never
logged, and cannot be retrieved after the one-time reveal. Rotation replaces it with a new
temporary password and invalidates the old one.

Critically, the provisional auth user does **not** receive a `tenant_members` row yet. Their first
login therefore mints no tenant claim and RLS exposes no company data. Sign-in routes them to a
dedicated activation page where they must replace the temporary password. Activation verifies the
authenticated email, provision, expiry, tenant state, and proposed role inside one guarded
transaction, then creates the membership and active-tenant profile state and refreshes the session.

If the email already belongs to an existing Chain user, the system must not reset that person's
password. It creates a pending tenant-access provision instead; the existing user signs in with
their own password and activates the additional tenant. The owner-facing response remains generic
enough not to expose another person's account history.

### 5.2 Guarded membership mutations

Replace direct app writes with RPCs:

- `create_provisional_tenant_account()`;
- `rotate_provisional_credential()`;
- `revoke_tenant_access_provision()`;
- `activate_tenant_access()`;
- `change_tenant_member_role()`;
- `remove_tenant_member()`;
- `switch_active_tenant()`.

Rules:

- owners can manage every non-self membership and may promote another owner;
- managers may manage planner, warehouse, finance, and viewer members but cannot create,
  promote, demote, or remove an owner/manager;
- nobody can remove themselves through the team-management action;
- a tenant must always retain at least one owner;
- activation is idempotent for the same user + tenant;
- role change/removal keeps the existing `token_generation` invalidation;
- all transitions are audit logged.

Direct member insert/update/delete policies should be tightened so app callers use the guarded
functions. Maintenance/service paths remain available for support and migrations.

## 6. Location assignments

Add `tenant_member_locations (tenant_id, user_id, location_id, created_at)` plus
`tenant_members.all_locations boolean not null default true`.

Backfill every existing member to `all_locations=true`, preserving current behavior. Owners must
always have all-location access in Wave 3. Managers default to all locations. Planner, warehouse,
finance, and viewer may be all-location or assigned to one or more active locations.

Add `can_access_location(location_id)` and apply it at the database boundary to every
location-scoped operational read/write table and RPC. `All locations` in the UI means all
locations the member is authorized to see, never all locations in the tenant by implication.
Tenant-global catalog and supplier records remain tenant-wide.

Assignment changes take effect on the next query because the helper reads membership tables;
they do not rely on stale location IDs embedded in the JWT. Removing the final assigned location
from a restricted member is rejected unless the same transaction grants another or switches the
member to all-location access.

## 7. Role capability contract

| Role | Primary work | Key mutations | Sensitive reads |
|---|---|---|---|
| Owner | company control + exceptions | all guarded admin and operating actions | billing, audit, valuation |
| Manager | operating control + approvals | team below manager, policies, approvals, operations | audit, plan, valuation |
| Planner | demand, supply, sourcing | forecasts, policy, reorder, RFQ/requisition/PO drafting | plan, catalog, supplier performance |
| Warehouse | physical material flow | receive, issue, adjust, count, hold/release, transfer | assigned-location inventory and tasks |
| Finance | value and commitment oversight | no physical or planning mutation in this wave | billing, audit, valuation, PO commitments, plan |
| Viewer | read-only operating visibility | personal alert/preferences only | authorized non-billing/non-audit operational reads |

The existing RLS matrix is the starting point, not blindly preserved. The Wave 3 migration audit
must reconcile every current policy and every service-role Server Action against this table.
Notably, the old matrix comments that warehouse writes balances directly are obsolete after the
W2-2.5 posting kernel; warehouse mutations must continue through guarded posting actions only.

## 8. Role-aware bench

### Shared chrome

- show the member role below their identity in the left rail;
- add tenant switching only when a user belongs to more than one tenant;
- preserve the W2-4 location selector, limited to authorized locations;
- add **Team** under Settings for owner/manager;
- hide actions and navigation the role cannot use, while direct URLs still resolve through RLS
  or a clear restricted surface.

### `/today` emphasis

Keep `/today` as one component tree with role-selected panels:

- **Owner/manager:** network exceptions, demand coverage, open commitments, approvals waiting;
- **Planner:** stockout risk, forecast exceptions, reorder/RFQ/requisition queue;
- **Warehouse:** receipts due, issues/counts/holds, transfer work by authorized location;
- **Finance:** inventory value, open PO commitment, valuation movement, supplier exposure;
- **Viewer:** read-only network health and shared plan.

The daily page must never imply permission from visibility. Every button retains its Server Action
and database gate.

## 9. Lightweight shared plan

Add `/plan` as the cross-functional S&OP surface. Recommendation for the one shared number:

**30-day demand coverage %**

`min(available + confirmed incoming, forecast demand over next 30 days) / forecast demand over
next 30 days`, aggregated across the member's authorized locations and active SKUs.

- available uses the shared position helper and excludes held/allocated stock;
- confirmed incoming uses open approved/sent POs due inside the horizon;
- demand uses the operating-mode demand source and the latest forecast bundle;
- SKUs without a usable forecast are excluded from the percentage and shown as a data-quality
  count, never treated as zero demand;
- zero forecast demand returns “No planned demand,” not 100%;
- the snapshot timestamp and coverage denominator are visible.

Secondary shared facts: uncovered demand units, uncovered demand valued at current average cost,
inventory value, open PO commitment, and the top coverage gaps by SKU/location. Every role reads
the same snapshot; the drill-down and next action differ by capability.

Start with a live read model. Add durable weekly plan snapshots only when the team needs meeting
history or explicit sign-off. Do not invent a consensus workflow before a design partner uses the
first shared view.

## 10. Build order after sign-off

1. **W3-0 — access spine hardening (BUILT 2026-07-17):** capability registry, membership mutation
   RPCs, last-owner guard, policy audit, role-matrix probes.
2. **W3-1 — provisional accounts + team bench (BUILT 2026-07-17):** owner-created accounts, one-time temporary
   credential reveal/rotation, forced password replacement, activation, member list and role
   changes, audit evidence.
3. **W3-2 — tenant switch + role-aware chrome:** active-tenant action/session refresh, role badge,
   nav/action visibility, role landing tests.
4. **W3-3 — location assignments:** mapping table, `can_access_location`, RLS/RPC rollout across
   every location-scoped surface, URL-tamper and cross-location probes.
5. **W3-4 — shared plan + daily emphasis:** 30-day coverage read model, `/plan`, role-emphasized
   `/today`, finance/planner/warehouse drill-downs.
6. **W3-5 — approval policy:** owner-configured requester auto-approval modes/limits and approver
   authority routing over the existing requisition decision trail.
7. **Review + production gate:** clean migration replay, full suite, six-role browser walkthrough,
   stale-session and provisional-account abuse review, MG sign-off, then merge/deploy.

Each slice keeps the normal build → evidence → MG review → code review → push gate.

## 11. MG decisions that gate implementation

### 11.1 Account creation and first login — LOCKED 2026-07-17

**MG decision:** the owner creates the person's account by entering email and role. The Chain
generates a temporary password for the owner to communicate directly. The user signs in with that
credential and must replace it before entering the tenant.

**Safety contract:** the temporary password is generated by the server and revealed once. The
provisional user receives no tenant membership or tenant claims until password replacement and
activation finish. Provisions expire and can be revoked or rotated. Existing Chain accounts keep
their current password and activate the additional tenant after normal sign-in.

### 11.2 Management boundary — LOCKED 2026-07-17

Recommendation: **owners control owner/manager roles; managers control only lower roles**. Multiple
owners are allowed, but the last owner cannot be demoted or removed. Nobody removes themselves from
the Team bench; account departure requires another owner.

**MG decision:** approved. There is no permanently privileged "main owner" record: owners are
peers. Any owner may manage another owner or manager, subject to the final-owner and no-self-removal
guards. Managers administer only lower roles.

### 11.3 Location access — LOCKED 2026-07-17

Recommendation: **ship database-enforced location assignments in Wave 3**, after basic team
activation. Owners always see all locations; other roles may be all-location or explicitly scoped.

**MG decision:** ship database-enforced location assignments in Wave 3.

### 11.4 The shared S&OP number — LOCKED 2026-07-17

Recommendation: **30-day demand coverage %**, with uncovered units and at-risk average-cost value
as secondary facts. It is mode-neutral, understandable across functions, and derivable from shipped
forecast, position, PO, and valuation data.

**MG decision:** use 30-day demand coverage %, with the documented supporting facts.

### 11.5 Requisition thresholds — LOCKED 2026-07-17

**MG decision:** ship the default as the current higher-approver workflow regardless of amount.
The requester submits to an eligible manager or owner, and the requester does not approve their
own requisition by default. Company-specific dollar authority must be configurable rather than
hard-coded globally.

**Implementation direction:** wire the policy foundation in Wave 3, then expose configuration after
the team roles exist. Approval authority is expressed per tenant and may assign different limits
to roles or named members (for example, one approver to $1,500 and another to $50,000). The shipped
default has no dollar ceiling for owner/manager approval and keeps separation of duties.

**MG clarification:** an owner may grant a requester automatic approval authority. If the submitted
requisition total is within that member's configured spend limit, the system approves it
immediately. Above the limit, it enters the normal approval queue. This applies to any member the
owner authorizes, not only a role named "requester."

The system must model three explicit owner-controlled states per member:

1. `always_require_approval` — every submitted requisition goes to an approver;
2. `auto_approve_to_limit` — totals at or below the configured amount approve automatically;
3. `auto_approve_unlimited` — submitted requisitions approve automatically without a ceiling.

Do not overload a null or zero amount to mean two different policies. The default for every
existing and newly activated member is `always_require_approval`.

Automatic approval is a **system decision based on owner-delegated authority**, not a user clicking
Approve on their own request. The transition must record the applicable policy/member snapshot,
limit, evaluated total, and reason (`within_requester_limit` or `unlimited_requester_authority`) in
the audit trail. Editing after approval remains forbidden; a changed request returns through a new
draft/version and is evaluated again.

Amounts above requester authority route to eligible approvers. The owner may separately configure
how much each approver can approve; the existing owner/manager queue remains the default until those
limits are configured.

## 12. Acceptance contract

- An owner can create, rotate, revoke, and inspect provisional account state without database
  access.
- Temporary passwords are high-entropy, one-time-visible, expiring, email-bound, tenant-bound, and
  grant no tenant data access before forced password replacement.
- A tenant can never lose its final owner.
- A manager cannot grant or mutate owner/manager access.
- Role/removal changes invalidate stale sessions; location changes take effect immediately.
- A restricted member cannot read or mutate another location by URL, RPC, or direct PostgREST.
- Each role sees a coherent daily bench and cannot trigger actions outside its capability contract.
- Tenant switching proves membership before changing active context and refreshes claims before the
  destination bench renders.
- Every role reads the same timestamped 30-day coverage result for the same authorized scope.
- Requester auto-approval follows the owner's explicit member policy, snapshots the evaluated
  authority and total, and sends above-limit requests to an eligible approver.
- Team, role, assignment, provision, activation, and switch events appear in the audit trail.
- Six-role RLS, cross-tenant, cross-location, stale-token, last-owner, provisional-credential,
  activation-replay, and self-escalation probes pass.
- Full suite, TypeScript, Biome, craft, clean migration replay, and authenticated browser evidence
  pass before production.

## 13. Explicit deferrals

- SAML/SSO, SCIM, directory sync, custom roles, and custom permission builders;
- per-field security and supplier/customer portal identities;
- automated account-credential delivery; owners communicate the one-time credential out of band;
- multi-step approval chains, delegation, absence coverage, and automatic approval;
- durable S&OP meeting snapshots, comments, sign-off, and scenario consensus;
- shift scheduling, labor planning, task assignment, and mobile push notifications.
