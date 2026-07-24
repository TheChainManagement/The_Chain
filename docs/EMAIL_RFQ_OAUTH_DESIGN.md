# The Chain: Customer-Mailbox RFQ Email Security Design

*Drafted 2026-07-23 for MG sign-off before implementation. This is a Phase 0 design only.
It is based on Decision 2 in `_reviews/2026-07-15_w2_fast_follow_decisions.md`, the shipped
RFQ and Wave 3 access code on `main` at `7ba2c3b`, and the current official Google and
Microsoft provider documentation linked below.*

*Status: **DRAFT - MG DECISIONS REQUIRED.** No application code or migration is authorized
until MG locks every decision in §16 and Claude completes the independent design audit.*

## 1. Outcome and non-negotiable contract

The Chain will send an RFQ to a supplier from a mailbox owned and OAuth-authorized by that
customer. Release 2 connects a Google Workspace or Microsoft 365 mailbox, lets an authorized
member confirm the final recipient and sender, sends the existing RFQ artifacts, and records
an independent delivery trail.

The contract is:

- The Chain never sends from a shared Chain address.
- `From` and `Reply-To` are the connected customer mailbox. A typed address is never
  authorization.
- The provider places the message in that mailbox's Sent folder.
- OAuth is the only mailbox authentication mechanism. The Chain never collects or stores a
  mailbox password.
- RFQ document state and email-delivery state are independent. A failed email neither rolls
  back nor mutates the RFQ.
- Manual CSV and print-sheet export remains a permanent fallback for every tenant.
- An email action is a document communication action. It never writes `inventory_levels`,
  `stock_movements`, or any other balance or movement table.
- Release 2 does not read the mailbox. Release 3 may recognize replies only after separate
  scope consent and review. Extracted quote data is always review-before-save.

This design is deliberately narrower than a general email integration. It does not provide an
inbox, campaign sending, arbitrary recipients, free-form sender spoofing, or mailbox-wide search.

## 2. Audit: what is already real

The release should extend the shipped procurement and access seams instead of replacing them:

- `src/app/api/exports/procurement/rfq/[rfqId]/[supplierId]/route.ts` authenticates the
  caller, loads the RFQ through tenant RLS, verifies that the supplier is on that RFQ, and
  generates a per-supplier CSV with `rfqToVendorCsv`.
- `src/app/print/rfq/[rfqId]/[supplierId]/page.tsx` is the authenticated, RLS-scoped
  letterhead print sheet. Together with CSV export, it is the permanent manual-send path.
- `src/lib/procurement/transform.ts` defines the current RFQ writer roles as owner, manager,
  and planner, validates when an RFQ can be sent, and protects CSV cells from formula
  injection.
- `src/app/(app)/procurement/rfqs/[rfqId]/RfqWorkbench.tsx` currently shows the CSV and
  print artifacts and exposes the document-level **Mark sent** action.
- `src/app/(app)/procurement/actions.ts` currently marks `rfqs.status`, `rfqs.sent_at`, and
  the selected `rfq_vendors.sent_at`. It does not send email. Release 2 must not silently
  reinterpret that document mutation as proof of provider delivery.
- `src/lib/procurement/queries.ts` uses the caller's RLS-scoped client for RFQ detail, but the
  current detail model does not load a supplier contact email.
- `src/lib/suppliers/queries.ts`, `src/lib/suppliers/transform.ts`, and
  `supabase/migrations/20260530120200_init_inventory.sql` show that a supplier contact is
  tenant-owned JSON in `suppliers.contact`, with an optional email. The queue operation must
  read that selected contact server-side and snapshot it. A client-supplied recipient is not
  authoritative.
- `supabase/migrations/20260712120000_w2_3a_procurement_schema.sql` defines RFQs as
  zero-balance documents, uses tenant-composite supplier references, gives procurement
  mutations to owner/manager/planner, and attaches the house audit trigger.
- `src/lib/access/roles.ts` defines the six-role spine. `procurement.manage` belongs to
  owner, manager, and planner; `integrations.manage` belongs to owner and manager.
- `src/lib/access/location-access.ts` and `src/lib/access/index.ts` are the live-membership
  and capability-registry patterns to reuse. `supabase/migrations/20260718130000_w3_3_location_assignments.sql`
  makes `can_access_location` the caller-pinned location boundary.
- `src/components/bench/LeftRail.tsx` and `src/lib/modes/nav.ts` hide navigation for role and
  operating mode, but that chrome is not authorization. Server and database gates remain the
  boundary.
- `supabase/migrations/20260531120000_audit_log_triggers.sql` defines
  `capture_audit()`. It redacts known credential keys, including `access_token`,
  `refresh_token`, and `encrypted_credentials`. `tests/foundation/audit-triggers.test.ts`
  probes that encrypted credentials do not leak into audit rows.
- `src/lib/qbo/crypto.ts`, `src/lib/qbo/connection.ts`,
  `src/app/api/qbo/oauth/callback/route.ts`, and
  `supabase/migrations/20260605120000_block6_qbo_connection.sql` provide a useful server-only
  OAuth precedent. The new mailbox design strengthens that precedent with per-record envelope
  encryption and a KMS-held wrapping key.

## 3. Provider architecture and exact scopes

### 3.1 One internal contract

Provider-specific code sits behind one server-only interface:

```ts
type MailProvider = 'google_workspace' | 'microsoft_365';

interface RfqMailProvider {
  exchangeAuthorization(input: OAuthCallback): Promise<VerifiedMailboxGrant>;
  refresh(grant: EncryptedGrant): Promise<RotatedGrant>;
  send(input: GeneratedRfqMessage, grant: DecryptedGrant): Promise<SendReceipt>;
  revokeBestEffort(grant: DecryptedGrant): Promise<RevokeResult>;
}

interface SendReceipt {
  acceptance: 'accepted' | 'rejected' | 'unknown';
  providerMessageId: string | null;
  providerThreadId: string | null;
  providerRequestId: string | null;
}
```

Only the adapter handles provider tokens or provider response bodies. The application gives it
an immutable generated message, not arbitrary mailbox operations. Adapter errors are normalized
to safe codes before leaving the server boundary. Provider bodies, headers, access tokens, and
refresh tokens never enter logs, client payloads, audit details, or error monitoring.

### 3.2 Release 2 scope matrix

| Provider | Exact requested scopes/parameters | Why each is required | Explicitly excluded |
|---|---|---|---|
| Google | `openid`, `email`, `https://www.googleapis.com/auth/gmail.send`; authorization parameter `access_type=offline` | `openid` gives an immutable subject, `email` gives the verified authenticated mailbox identity, `gmail.send` sends MIME as `me`, and offline access is needed for a refresh token | `gmail.compose`, `gmail.modify`, `gmail.readonly`, `gmail.metadata`, Contacts, Drive, and broad `mail.google.com` |
| Microsoft | `openid`, `offline_access`, `User.Read`, `Mail.Send` | `openid` binds the Entra principal, `offline_access` requests a refresh token, `User.Read` lets the callback resolve `/me` and the actual mailbox identity, and delegated `Mail.Send` sends as that user and saves to Sent Items | application permissions, `Mail.Read`, `Mail.ReadWrite`, `Mail.Send.Shared`, contacts, files, and directory-wide scopes |

Google classifies `gmail.send` as a **sensitive** scope. It is enough for
`users.messages.send`; a raw MIME message is base64url encoded and sent as `userId=me`.
Google documents that Gmail sends create a message with the `SENT` label. Sources:
[Gmail scope classification](https://developers.google.com/workspace/gmail/api/auth/scopes),
[messages.send](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send),
[sending guide](https://developers.google.com/workspace/gmail/api/guides/sending), and
[OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server).

Microsoft delegated `Mail.Send` requires no tenant-wide admin consent by default, can send as
the signed-in user, and can save a copy in Sent Items without `Mail.ReadWrite`. `sendMail`
returns `202 Accepted`; that acknowledges request acceptance, not completed transport, and
does not return a message or thread ID. Sources:
[Microsoft Graph permission reference](https://learn.microsoft.com/en-us/graph/permissions-reference),
[OIDC and offline access](https://learn.microsoft.com/en-us/entra/identity-platform/scopes-oidc),
and [user sendMail](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0).

Release 2 supports only the directly authenticated mailbox. It does not let a user type an alias
or delegated/shared mailbox into `From`. A company can connect a dedicated procurement account,
but provider-specific alias and delegate support is a later, separately reviewed capability.
This avoids Google send-as ambiguity and avoids adding Microsoft `Mail.Send.Shared`.

### 3.3 Release 3 incremental scopes

Reply recognition is a separate feature flag, consent screen, and connection capability:

| Provider | Additional release 3 scope | Justification |
|---|---|---|
| Google | `https://www.googleapis.com/auth/gmail.readonly` | Read reply headers, body, and attachments and call `users.watch`/history for the authenticated mailbox. `gmail.metadata` cannot read bodies or attachments and is therefore insufficient. |
| Microsoft | delegated `Mail.Read` | Subscribe to and fetch messages, including the body and attachments, in the authenticated mailbox. `Mail.ReadBasic` omits body and attachments. |

Do not request release 3 scopes during release 2. Existing connections enter
`reconsent_required` when reply recognition is enabled and use provider incremental consent.
Google `users.watch` requires a compatible read scope and a renewable Google Cloud Pub/Sub
watch. Microsoft message change subscriptions require mail-read permission and renewal. Sources:
[Gmail users.watch](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/watch)
and [Outlook change notifications](https://learn.microsoft.com/en-us/graph/outlook-change-notifications-overview).

### 3.4 Registration, verification, and rollout

**Google**

- Use a production Google Cloud project owned by The Chain, verified domains, production OAuth
  redirect URIs, an accurate consent screen, privacy policy, terms, and a minimal scope
  justification.
- Submit `gmail.send` for sensitive-scope verification before public rollout. Internal test
  tenants and provider test users do not replace verification.
- Adding `gmail.readonly` in release 3 triggers a new restricted-scope review. When restricted
  data passes through or is stored by The Chain's servers, Google requires an independent
  security assessment and annual reassessment. Treat this as a release-3 schedule gate, not a
  small scope toggle.
- Google describes review durations as estimates, not SLAs. The project must remain behind a
  tenant allowlist until the production consent configuration is verified.

Official sources:
[OAuth verification overview](https://support.google.com/cloud/answer/13463073),
[verification requirements](https://support.google.com/cloud/answer/13464321),
[review timing estimates](https://support.google.com/cloud/answer/13463817),
[restricted-scope assessments](https://support.google.com/cloud/answer/13465431), and
[adding scopes](https://support.google.com/cloud/answer/13464018).

**Microsoft**

- Register one multitenant Entra application for organizational accounts, with exact production
  redirect URIs, delegated permissions only, and no application mailbox permission.
- Complete Microsoft publisher verification before broad rollout so customer admins see a
  verified publisher. Configure an admin-consent request path because an organization's user
  consent policy may block `Mail.Send` even though Microsoft marks it as not requiring admin
  consent by default.
- Store client credentials as deployment secrets, rotate them independently from tenant mailbox
  grants, and use separate development and production app registrations.
- Release 3 adds delegated `Mail.Read` through incremental consent. It does not silently upgrade
  existing grants.

Official sources:
[publisher verification](https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview),
[application consent](https://learn.microsoft.com/en-us/entra/identity-platform/application-consent-experience),
and [granting tenant-wide admin consent](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/grant-admin-consent).

## 4. Token storage and encryption

### 4.1 Compared options

| Option | Strength | Problem for this integration |
|---|---|---|
| Supabase Vault / pgsodium-style database encryption | Keeps encrypted material near PostgreSQL and can hide plaintext behind database functions | pgsodium is deprecated for new Supabase projects; database-side decrypt functions enlarge the database privilege surface and make external provider work and key rotation harder to isolate |
| libsodium sealed boxes | Strong asymmetric separation and no shared decrypt key in the database | Still needs an external private-key custody, availability, versioning, and rotation system; sealed-box rotation generally requires decrypt/re-encrypt rather than cheap key rewrapping |
| App-layer AES-256-GCM with one static environment key | Simple and matches the existing QBO precedent | One long-lived key decrypts every tenant grant; rotation rewrites every ciphertext and a leaked environment value compromises the whole set |
| **AES-256-GCM envelope encryption with a KMS-held key-encryption key** | Per-record data keys, authenticated encryption, versioned context, least-privilege KMS use, and cheap data-key rewrapping | Adds a managed KMS dependency and an operational rotation job |

**Recommendation:** use envelope encryption. For each connection, generate a random 256-bit data
encryption key (DEK), encrypt the canonical token bundle with AES-256-GCM, and ask a managed KMS
key-encryption key (KEK) to wrap the DEK. Bind authenticated additional data to
`tenant_id`, `connection_id`, provider, provider subject, and format version so ciphertext cannot
be transplanted across tenants or connection rows.

The stored secret record contains only:

- ciphertext, nonce, and authentication tag;
- wrapped DEK;
- KEK resource/version identifier;
- encryption format version;
- token issue/expiry metadata that is safe to query without decrypting;
- created/rotated timestamps.

The KMS key is never stored in Supabase or as plaintext in Vercel. Only the production OAuth
callback, refresh worker, send worker, and rotation job receive KMS unwrap permission. Development
uses a separate KMS key and provider app registrations.

### 4.2 Database boundary

Use two tables:

1. `mailbox_connections` stores tenant-visible metadata: provider, immutable provider subject,
   normalized mailbox address, display name, status, granted-scope fingerprint, health,
   last-success timestamp, and creator.
2. `mailbox_connection_secrets` stores the encrypted token bundle and wrapping metadata.

`mailbox_connection_secrets` has RLS enabled with no authenticated policies, no authenticated
table grants, and no client RPC. Only `service_role` may select or mutate it through narrow,
server-only functions. `mailbox_connections` never contains access or refresh tokens.

The house audit trigger attaches to metadata and delivery tables, not the secret table. If policy
requires auditing secret lifecycle, a separate redacted event records only connection ID, actor,
operation (`created`, `refreshed`, `rewrapped`, `deleted`), key version, and timestamp. It never
passes the secret row through `capture_audit()`. The existing denylist in
`supabase/migrations/20260531120000_audit_log_triggers.sql` remains defense in depth, not the
primary control.

### 4.3 Rotation

- **Refresh-token rotation:** replace the encrypted canonical bundle atomically only after a
  successful provider refresh. Microsoft may return a new refresh token; retain the new token
  and securely discard the old one as Microsoft directs. Never overwrite a valid refresh token
  with an absent response field.
- **KEK rotation:** create a new KMS version and rewrap each DEK from old KEK to new KEK without
  decrypting the token bundle. Readers accept an explicit allowlist of current and previous key
  versions during the bounded migration, then the old version is disabled.
- **Cipher/format rotation:** decrypt and re-encrypt each bundle through a controlled job, with
  idempotent checkpoints and redacted metrics.
- **Incident rotation:** disable sending first, revoke provider grants where possible, delete
  local secret records, rotate KMS and provider client credentials, and require re-consent.

## 5. Connection lifecycle

### 5.1 State machine

`pending_oauth -> active -> refresh_required -> reconsent_required`

Any live state may move to `disconnecting -> disconnected`. Provider denial, invalid grant,
disabled mailbox, or scope loss moves the connection to `reconsent_required`, not to silent
fallback under another mailbox.

### 5.2 Connect

1. An authenticated owner or manager with live `integrations.manage` capability starts OAuth.
2. The server creates a one-time state record containing a high-entropy nonce, tenant ID, actor
   ID, provider, PKCE verifier where supported, intended return path, and short expiry. Store it
   server-side; the browser gets only the opaque state and secure, HttpOnly, SameSite cookie.
3. The callback validates state exactly once, callback origin, expiry, current membership,
   active tenant, and live `integrations.manage` before token exchange.
4. The server validates issuer, audience, nonce, signature, and provider subject. It calls
   provider identity as `me` where needed and records the actual OAuth-authenticated mailbox.
5. A typed mailbox, tenant default, email-domain match, or admin claim never substitutes for the
   provider identity proof.
6. The token bundle is encrypted before persistence. Connection metadata becomes `active` only
   after secret storage succeeds.
7. The UI shows the provider-returned mailbox and asks for a final confirmation before making it
   eligible as a tenant default.

One provider subject may have at most one active connection per tenant/provider. The same mailbox
may be connected to two tenants only if MG explicitly accepts that risk in §16.8.

### 5.3 Refresh and provider-side revocation

Refresh occurs server-side before expiry with a jittered safety window and a per-connection
advisory lock so concurrent sends cannot race token rotation. A single transient failure keeps
the connection active and schedules bounded backoff. Provider `invalid_grant`, revoked consent,
disabled-account responses, or missing required scopes atomically set `reconsent_required` and
stop new sends.

Google refresh-token issuance can depend on offline consent and prior grants, so a callback that
does not yield a usable refresh path must not activate a new connection. Microsoft refresh token
responses are rotated as documented:
[Microsoft refresh tokens](https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens).

### 5.4 Disconnect and queued work

Disconnect is an owner/manager action with live capability revalidation and explicit mailbox
confirmation.

- In one transaction, mark the connection `disconnecting`, clear it as the tenant default, and
  cancel every `queued` or retry-waiting delivery tied to it with safe reason
  `mailbox_disconnected`.
- A leased `sending` attempt is not deleted. The worker either records `sent`, `failed`, or
  `delivery_unknown`. Disconnect waits a short bounded drain window, then proceeds.
- Best-effort provider revocation runs server-side. Google supports token revocation. Microsoft
  does not justify requesting broad grant-management scopes merely to revoke this one grant, so
  local secret deletion is the immediate security boundary and the UI links the administrator
  to Microsoft's account/enterprise-app revocation controls.
- Delete the encrypted token bundle, wrapped DEK, pending OAuth state, webhook subscription
  secrets, and refresh leases. Retain non-secret connection identity, redacted lifecycle audit,
  and historic delivery snapshots for the approved retention period.
- Reconnecting creates a new connection ID. Old delivery rows never become attached to the new
  grant.

## 6. Tenant administration and the role spine

### 6.1 Capabilities

- **Connect, disconnect, set default, and change override policy:** owner and manager through the
  existing `integrations.manage` capability.
- **Send an RFQ:** owner, manager, and planner through `procurement.manage`, subject to current
  RFQ state and W3-3 access to the RFQ location.
- **View delivery history:** members who may read that RFQ at that location. Token, raw provider
  error, and secret health detail are never visible.
- **Retry or resolve `delivery_unknown`:** owner/manager by default. This avoids a planner
  accidentally duplicating an ambiguous send.

The visible registry in `src/lib/access/roles.ts` gets granular mailbox capabilities only if the
build demonstrates that overloading `integrations.manage` or `procurement.manage` would create a
real mismatch. PostgreSQL remains authoritative.

### 6.2 Guard shape

Follow the W3 convention while keeping the service credential out of the browser:

- the authenticated authorization RPC is `SECURITY INVOKER`, pins
  `p_tenant = jwt_tenant_id()` and the actor to `auth.uid()`, and returns only a short-lived,
  single-use authorization result to the server action;
- a narrow `SECURITY DEFINER`, `search_path=''` helper may lock and read current membership to
  answer a single capability question, as in the hardened requisition authority path;
- RFQ location access uses caller-pinned `can_access_location(rfq.location_id)`;
- because the delivery table deliberately grants authenticated users no insert privilege, the
  server action calls a service-only enqueue function after the invoker check. That function
  accepts semantic IDs and the actor captured from the authenticated session, re-reads the
  actor's current membership/capability, RFQ location, supplier contact, connection, tenant
  policy, and authorization-result nonce, derives every snapshot, and consumes the nonce in the
  same transaction. It does not trust a client or the first check;
- the service worker never accepts tenant, actor, recipient, or sender authority from its job
  payload. It loads the already-guarded delivery row and revalidates the connection/tenant pair;
- default-deny RLS and composite tenant foreign keys are required even when an RPC already
  checked the same condition.

JWT role and hidden navigation are not authorization. A demoted or location-restricted member
must lose send capability immediately without waiting for token refresh. The two-step server
seam is required because a `SECURITY INVOKER` function cannot insert through default-deny RLS
without giving authenticated callers a direct insert policy. Granting that policy would let a
caller bypass snapshot derivation.

### 6.3 Defaults and overrides

Add tenant settings with:

- one optional default procurement `mailbox_connection_id`;
- `mailbox_override_policy`: recommended default `owner_manager_only`;
- an enabled/disabled send switch for incident response.

The final send dialog always displays:

- **To:** the selected supplier contact name and email loaded from tenant data;
- **From:** the immutable connected mailbox;
- **Reply-To:** the same immutable connected mailbox;
- subject, artifact names, RFQ number, supplier, and location;
- whether the mailbox is the tenant default or an authorized override.

Changing the supplier contact or mailbox after the dialog opens invalidates the confirmation
token. The queue RPC loads and snapshots the current authoritative values again.

## 7. Delivery audit schema

This is a DDL sketch for the future reviewed migration, not executable work in this phase.
Names may be adjusted to the next free migration only after sign-off.

```sql
-- Required so every child reference carries tenant identity.
alter table public.rfqs
  add constraint rfqs_tenant_identity unique (tenant_id, id);

alter table public.rfq_vendors
  add constraint rfq_vendors_tenant_identity
  unique (tenant_id, rfq_id, supplier_id);

create table public.rfq_email_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  rfq_id uuid not null,
  supplier_id uuid not null,
  location_id uuid not null,
  mailbox_connection_id uuid not null,

  -- Immutable queue-time snapshots.
  rfq_number_snapshot text not null,
  supplier_name_snapshot text not null,
  recipient_name_snapshot text,
  recipient_email_snapshot citext not null,
  sender_name_snapshot text,
  sender_email_snapshot citext not null,
  reply_to_email_snapshot citext not null,
  subject_snapshot text not null,
  body_text_snapshot text not null,
  body_html_snapshot text,
  artifact_manifest jsonb not null,
  content_sha256 text not null,

  provider text not null
    check (provider in ('google_workspace', 'microsoft_365')),
  provider_message_id text,
  provider_thread_id text,
  provider_request_id text,
  internet_message_id text not null,

  requested_by_user_id uuid not null references auth.users(id),
  requested_at timestamptz not null default now(),
  state text not null default 'queued'
    check (state in (
      'queued', 'sending', 'retry_wait', 'sent',
      'failed_permanent', 'delivery_unknown', 'canceled'
    )),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz,
  lease_owner text,
  lease_expires_at timestamptz,
  started_at timestamptz,
  sent_at timestamptz,
  failed_at timestamptz,
  canceled_at timestamptz,

  -- Safe normalized failure fields only. No provider body or headers.
  failure_category text check (failure_category in (
    'authentication', 'authorization', 'recipient',
    'rate_limit', 'provider_transient', 'provider_permanent',
    'transport_ambiguous', 'mailbox_disconnected', 'policy'
  )),
  failure_code text,
  failure_detail_redacted text,

  idempotency_key uuid not null,
  supersedes_attempt_id uuid references public.rfq_email_delivery_attempts(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint rfq_email_delivery_rfq_vendor_fk
    foreign key (tenant_id, rfq_id, supplier_id)
    references public.rfq_vendors(tenant_id, rfq_id, supplier_id),
  constraint rfq_email_delivery_location_fk
    foreign key (tenant_id, location_id)
    references public.locations(tenant_id, id),
  constraint rfq_email_delivery_connection_fk
    foreign key (tenant_id, mailbox_connection_id)
    references public.mailbox_connections(tenant_id, id),
  constraint rfq_email_delivery_sender_reply_to_check
    check (sender_email_snapshot = reply_to_email_snapshot),
  constraint rfq_email_delivery_terminal_time_check check (
    (state = 'sent' and sent_at is not null)
    or (state = 'failed_permanent' and failed_at is not null)
    or (state = 'canceled' and canceled_at is not null)
    or state in ('queued', 'sending', 'retry_wait', 'delivery_unknown')
  ),
  constraint rfq_email_delivery_idempotency_uq
    unique (tenant_id, idempotency_key)
);

create index rfq_email_delivery_queue_idx
  on public.rfq_email_delivery_attempts (state, next_attempt_at, requested_at)
  where state in ('queued', 'retry_wait');

create index rfq_email_delivery_rfq_idx
  on public.rfq_email_delivery_attempts
    (tenant_id, rfq_id, supplier_id, requested_at desc);

alter table public.rfq_email_delivery_attempts enable row level security;
alter table public.rfq_email_delivery_attempts force row level security;

-- Read only the active tenant and an authorized RFQ location.
create policy rfq_email_delivery_attempts_select
  on public.rfq_email_delivery_attempts
  for select to authenticated
  using (
    tenant_id = public.jwt_tenant_id()
    and public.can_access_location(location_id)
  );

-- Authenticated callers do not get INSERT/UPDATE/DELETE policies.
-- The authenticated SECURITY INVOKER authorization RPC performs caller-pinned
-- checks. A service-only enqueue function consumes its one-time result, repeats
-- live membership/RFQ/contact/location/mailbox checks, derives all snapshots,
-- and inserts. Worker transitions also use narrow service-only functions.

create trigger rfq_email_delivery_attempts_updated_at
  before update on public.rfq_email_delivery_attempts
  for each row execute function public.set_updated_at();

create trigger audit_rfq_email_delivery_attempts
  after insert or update or delete on public.rfq_email_delivery_attempts
  for each row execute function public.capture_audit();
```

Before migration, the DDL must also enforce:

- `(tenant_id, id)` uniqueness on `mailbox_connections`;
- a state-transition trigger so a client PATCH cannot forge `sent`, provider IDs, failures, lease
  fields, timestamps, snapshots, or `requested_by_user_id`;
- maximum lengths for snapshot and error fields;
- normalized address validation in the server and database-safe length checks;
- `artifact_manifest` shape validation and content hashes;
- retention-safe audit behavior for body snapshots. If the house audit stores full rows, the
  migration must prevent duplicate message bodies from entering `audit_logs` by redacting those
  snapshot keys or moving content to a separately retained immutable payload table.

The delivery row is an attempt, not “the RFQ was sent.” A deliberate resend creates a new row
with a new idempotency key and `supersedes_attempt_id`; history is not overwritten.

## 8. RLS, audit, and abuse probes

The real-database suite must prove all of the following:

1. Tenant A cannot select, queue, retry, cancel, or infer a Tenant B delivery ID.
2. Tenant A cannot pair its RFQ with Tenant B's supplier, mailbox, location, or actor.
3. A member restricted away from the RFQ location cannot read or queue its delivery.
4. An owner/manager can connect and set a default; planner, warehouse, finance, and viewer
   cannot, including direct RPC and PostgREST probes.
5. Owner/manager/planner can queue only while they have live `procurement.manage`; warehouse,
   finance, viewer, and a demoted stale-token actor cannot.
6. A client-supplied `requested_by`, recipient, sender, provider, tenant, or snapshot is ignored
   or rejected. Authoritative values come from `auth.uid()` and server/database reads.
7. A typed sender that differs from the OAuth identity is rejected. A mailbox override not
   allowed by tenant policy is rejected.
8. The same tenant idempotency key returns the existing attempt and never creates a second row.
   The same key in a different tenant does not collide or leak existence.
9. Direct updates to state, provider IDs, timestamps, snapshots, failure fields, and attempt
   count are rejected for authenticated callers.
10. Only sanctioned worker transitions follow the state graph. Terminal attempts cannot return
    to `queued`.
11. Disconnect cancels queued/retry-wait attempts, purges the secret, and leaves historic
    delivery snapshots readable under RLS.
12. Audit rows contain lifecycle metadata but no access token, refresh token, wrapped DEK,
    plaintext DEK, provider authorization header, OAuth code, state secret, or unredacted
    provider response.
13. Queue and worker functions write zero rows to `inventory_levels` and `stock_movements`;
    balance and movement hashes are identical before and after successful, failed, duplicate,
    and canceled sends.
14. A provider failure changes only the delivery attempt and connection health. RFQ status,
    lines, vendor selection, quote data, and sourcing lifecycle remain unchanged.

## 9. Send flow and generated artifacts

### 9.1 Confirmation and queue

1. The RLS-scoped RFQ workbench requests a server-built confirmation model.
2. The server loads the RFQ, selected `rfq_vendors` row, current supplier contact, location,
   live sender capability, tenant mailbox policy, and connection metadata. It renders a short
   lived signed confirmation token over their versions and hashes.
3. The UI shows final To, From, Reply-To, subject, supplier, location, and artifacts. No field
   permits an arbitrary sender or recipient.
4. Confirmation calls a tenant-pinned, actor-pinned `SECURITY INVOKER` authorization RPC. It
   repeats caller-side checks and creates a short-lived, single-use authorization result.
5. The same server action generates and hashes the artifacts, then calls the service-only enqueue
   function. The function consumes that result, independently repeats live membership,
   capability, RFQ, supplier-contact, location, mailbox, and policy checks, derives the snapshots,
   inserts one attempt, and returns its ID. It does not call the provider inside the database
   transaction and does not mutate RFQ status.
6. A server worker claims the attempt with `FOR UPDATE SKIP LOCKED`, a bounded lease, and an
   atomic `queued/retry_wait -> sending` transition. It loads the connection secret through the
   service-only boundary, refreshes if necessary, and calls the provider adapter.

### 9.2 Artifact contract

Reuse the current per-supplier content:

- generate the same sanitized CSV through the shared generator behind
  `src/app/api/exports/procurement/rfq/[rfqId]/[supplierId]/route.ts`;
- generate a stable PDF or HTML representation from the same RFQ letterhead view represented by
  `src/app/print/rfq/[rfqId]/[supplierId]/page.tsx`;
- never fetch the authenticated export URL from the worker as if a browser session were an
  internal credential. Factor generation into a server-only artifact service in the build slice;
- freeze bytes and SHA-256 hashes at queue time. A later RFQ edit cannot change a queued
  message;
- record filename, media type, byte length, hash, and generator version in
  `artifact_manifest`, not a public URL;
- enforce provider attachment and total message-size limits before queueing.

The stored body is the exact Chain-generated request message. The mailbox provider remains the
canonical source for the sent RFC 822 message and transport behavior.

### 9.3 Idempotency and ambiguous acceptance

The UI generates one UUID idempotency key per confirmation. Duplicate client submissions return
the existing attempt. Workers use leases and compare-and-set transitions so only one worker owns
an attempt.

No provider offers a general exactly-once send guarantee for this shape. Gmail returns a message
ID after acceptance, but Microsoft `sendMail` returns only `202`. A network failure can occur
after provider acceptance but before The Chain records it. Therefore:

- include a Chain-generated RFC `Message-ID` and delivery ID in provider-safe message headers
  where supported and in the audit row;
- automatically retry only a clearly rejected, retryable provider response;
- on a timeout, broken connection, worker death during the provider call, or any other ambiguous
  outcome, mark `delivery_unknown` and do not automatically resend;
- show the administrator how to inspect the connected mailbox's Sent folder. A deliberate
  **Send again** creates a new attempt linked by `supersedes_attempt_id`;
- release 3 may reconcile `delivery_unknown` by reading the mailbox with separately consented
  read scope.

This rule prefers a visible uncertain state over silently sending duplicate RFQs.

### 9.4 Rate limits and backoff

Google currently documents per-project and per-user quota units and assigns 100 quota units to
`messages.send`; limits and Workspace daily sending rules can change. Microsoft documents
resource-unit throttling, `429` with `Retry-After`, and Outlook service limits per app/mailbox.
The implementation must treat provider limits as runtime responses, not hard-coded capacity.
Sources:
[Gmail quota](https://developers.google.com/workspace/gmail/api/reference/quota),
[Microsoft Graph throttling](https://learn.microsoft.com/en-us/graph/throttling), and
[service-specific throttling limits](https://learn.microsoft.com/en-us/graph/throttling-limits).

Use a per-connection queue, bounded global concurrency, and provider-aware token bucket.
Honor `Retry-After`; otherwise use truncated exponential backoff with full jitter. Cap attempts
and elapsed time, then surface a permanent failure or re-consent state. Never hold a database
transaction open during network I/O.

### 9.5 Zero-balance enforcement

Email code has no dependency on the posting kernel and receives no admin client capable of
calling inventory movement functions. The queue RPC may read RFQ, supplier, location, and
connection metadata and may write only delivery/audit state. The worker role receives narrow
delivery and secret functions, not generic inventory table privileges. Real-DB tests compare
balance/movement rows before and after every send outcome.

## 10. Delivery state and user experience

The RFQ page shows delivery history per supplier:

- `queued`: safely recorded, waiting for provider work;
- `sending`: leased by the worker;
- `retry_wait`: provider explicitly rejected with a retryable result;
- `sent`: provider accepted the request and The Chain recorded the receipt;
- `failed_permanent`: provider clearly rejected it and retry will not help;
- `delivery_unknown`: provider may have accepted it; no automatic resend;
- `canceled`: disconnected mailbox or explicit cancellation before provider work.

“Sent” means provider acceptance, not guaranteed supplier delivery, inbox placement, or reading.
Release 2 has no delivery/read receipt claim. Safe failure detail is actionable but does not show
raw provider payloads. Manual export remains visible in every state.

The existing **Mark sent** document action must remain explicitly manual or be renamed so users
cannot confuse it with provider delivery. The delivery table does not automatically drive
`rfqs.status`. Any later rule connecting sourcing workflow to delivery must be a separate MG
decision and guarded document transition.

## 11. Retention and privacy

### 11.1 Stored

- connection identity, provider, consented scope fingerprint, state, and health metadata;
- encrypted token bundle only while connected;
- queue-time To/From/Reply-To, subject, exact Chain-generated body, artifact manifest and hashes,
  provider IDs when returned, state transitions, actor, timestamps, and redacted failures;
- generated artifact bytes in private tenant-scoped object storage only if deterministic
  regeneration cannot meet legal/audit needs. Prefer storing immutable bytes with the same
  delivery retention so the audit proves what was sent.

### 11.2 Not stored

- mailbox passwords;
- arbitrary mailbox contents, contacts, inbox index, or Sent-folder copy;
- raw OAuth codes, state values, authorization headers, raw provider errors, access tokens, or
  refresh tokens outside the encrypted secret record;
- release-3 reply bodies or attachments before that feature has its own approved retention and
  review design.

### 11.3 Lifecycle

Recommended default retention is 24 months after the attempt reaches a terminal state, with a
tenant-configurable shorter period where contractual requirements allow. Connection lifecycle
metadata follows the same period. Audit-event retention must be reconciled so deleting the body
snapshot does not leave a full duplicate in `audit_logs`.

Disconnect immediately deletes active token material and pending webhook secrets, but preserves
historic delivery evidence until retention expiry. Tenant export includes connections without
secrets, mailbox policy, every delivery snapshot, artifacts, provider identifiers, redacted
failures, and lifecycle events. Tenant deletion purges token material first, then private
artifacts, delivery rows, connection metadata, webhook subscriptions, and compatible audit
records according to the existing legal hold/deletion contract.

Restrict message body and recipient snapshots to users who can read the RFQ and location.
Observability uses delivery IDs, provider category, latency, and safe error codes, never email
addresses or message content.

## 12. Threat model

| Threat | Primary mitigation | Required proof |
|---|---|---|
| Token theft from database | Per-record AES-GCM envelope encryption, KMS-held KEK, service-only secret table, no audit/log/client exposure | authenticated/service separation, ciphertext transplant failure, key-version rotation test |
| Token theft from runtime | Narrow KMS identity, decrypt only around adapter call, no token serialization/logging, bounded process lifetime | log/error snapshot tests and secret-scanner fixtures |
| Cross-tenant send | JWT tenant pinning, `auth.uid()` actor binding, composite tenant FKs, live RFQ/mailbox/location reads, default-deny RLS | cross-tenant matrix for every identifier |
| Confused deputy through mailbox override | Override is a connection ID from the same tenant, immutable OAuth identity, policy and capability rechecked at queue time | typed/foreign/disconnected/unauthorized override probes |
| Arbitrary-recipient abuse | Recipient loaded from selected RFQ supplier contact and snapshotted; no free-form To/Bcc/Cc in release 2 | client-tamper probe and contact-version invalidation |
| Replay or double click | Tenant-scoped idempotency key, immutable attempt, worker lease and state CAS | concurrent duplicate submissions and workers |
| Duplicate after ambiguous network result | `delivery_unknown`, no automatic resend, explicit linked resend, later read-scope reconciliation | forced timeout/crash probe |
| OAuth CSRF or callback substitution | One-time server state, PKCE where supported, nonce, issuer/audience/signature checks, tenant/actor revalidation | wrong state, replay, expired state, wrong issuer/tenant tests |
| Revoked or demoted user | Live membership/capability and location check at confirmation and queue, no JWT-role trust on service path | stale-token downgrade and location-removal probes |
| Provider webhook spoofing in release 3 | No webhooks in release 2. Google validates Pub/Sub authenticated push audience/service identity and maps immutable topic/watch; Microsoft validates endpoint handshake, constant-time `clientState`, subscription/tenant IDs, expiry, and lifecycle events. Fetch message through provider after validation rather than trusting notification content. | forged token/state/subscription, replay, duplicate, expiry, and cross-tenant webhook probes |
| Malicious content in supplier/contact/RFQ | HTML escaping, MIME header sanitation, address parser, CRLF rejection, CSV formula protection, attachment limits | injection and malformed-address fixtures |
| Broad service-role compromise | Narrow database functions, worker-specific credentials where platform permits, no generic client in provider adapter, egress allowlist | privilege inventory and negative function-grant tests |

Microsoft requires webhook endpoints to validate `clientState`; timely responses and subscription
renewal are part of the delivery contract:
[Graph webhook delivery](https://learn.microsoft.com/en-us/graph/change-notifications-delivery-webhooks).
Gmail watches expire and must be renewed. Release 3 also needs replay-safe history cursors and
provider-independent deduplication.

## 13. Release 2 slice plan and test gates

### Slice E0 - provider registration and secret boundary

- Create separate development provider apps, redirect URI inventory, consent-screen text,
  publisher verification plan, KMS key hierarchy, and operational runbook.
- Build no send UI yet.
- Tests: OAuth state/PKCE/nonce abuse, token log redaction, KMS additional-data binding, unwrap
  denial, key rewrap, refresh-token rotation, provider callback identity.

### Slice E1 - connection metadata, policy, and admin surface

- Add metadata/secret/settings schema, default-deny RLS, audit-safe lifecycle events, guarded
  connect/disconnect/default actions, and owner/manager UI.
- Tests: six-role real-DB matrix, cross-tenant connection probes, stale-role downgrade,
  duplicate subject, disconnect cancellation, audit secret absence, tenant export/delete.

### Slice E2 - immutable delivery queue and confirmation

- Add delivery schema, transition guards, confirmation model, supplier-contact selection,
  default/override policy, and queue RPC. Keep provider sending disabled.
- Tests: every probe in §8, concurrent idempotency, snapshot tamper, foreign supplier/location,
  location removal, artifact hashing, state-patch rejection, zero-balance before/after.

### Slice E3 - Google send adapter

- Implement MIME generation, Gmail `messages.send`, refresh, normalized errors, queue worker,
  Sent-folder acceptance evidence, and allowlisted tenant rollout.
- Tests: adapter contract fixtures plus provider sandbox/manual evidence; success, invalid grant,
  explicit 429, explicit 5xx, timeout ambiguity, worker crash, disconnect race, no token logs.

### Slice E4 - Microsoft send adapter

- Implement Graph `/me/sendMail`, `saveToSentItems=true`, rotated refresh handling, normalized
  errors, and the `202`/no-message-ID audit contract.
- Tests: the same failure matrix, explicit assertion that `202` yields `sent` with nullable
  provider IDs, ambiguous timeout yields `delivery_unknown`, admin-consent failure guidance.

### Slice E5 - hardening and rollout

- Add history UI, incident disable switch, metrics without PII, retention job, tenant
  export/delete, accessibility, browser walkthroughs, and operations runbook.
- Gate with clean migration replay; full Vitest, TypeScript, Biome, craft, and production build;
  real-DB six-role/cross-tenant/cross-location suites; OAuth security review; provider
  verification; Claude checkpoint; MG production gate.

Every slice follows Codex build -> evidence -> Claude review -> MG gate. No slice inherits
production approval merely because an earlier slice passed.

## 14. Acceptance contract

- A connected sender is exactly the mailbox proved by OAuth, and From equals Reply-To.
- No mailbox password or arbitrary sender address is accepted anywhere.
- Release 2 grants only the scopes in §3.2 and cannot read mailbox content.
- Only live owner/manager members manage connections; only live owner/manager/planner members
  with RFQ-location access queue a send.
- Final To, From, Reply-To, subject, and artifacts are visible before confirmation and are
  authoritatively reloaded at queue time.
- One user confirmation creates one immutable attempt under concurrent retries.
- Ambiguous provider outcomes never trigger an automatic duplicate.
- Provider failure and disconnect do not mutate RFQ sourcing state.
- Tokens never appear in logs, audit rows, client payloads, exports, or error monitoring.
- Tenant and location RLS, composite FKs, guarded transitions, audit events, and all probes in
  §8 pass against a clean local database.
- Successful, failed, canceled, duplicate, and unknown delivery paths write zero inventory
  balances and zero stock movements.
- Manual CSV and print-sheet export remains usable without any mailbox connection.
- Provider verification, operating runbook, retention job, and tenant export/delete are complete
  before production access.

## 15. Explicit deferrals

- reading inbox or Sent-folder content in release 2;
- reply recognition, webhooks, Pub/Sub watches, Graph subscriptions, and message reconciliation
  until release 3 consent and security review;
- automated quote extraction before a review-before-save workflow exists;
- arbitrary recipients, Cc/Bcc, free-form sender, marketing/bulk email, templates, and campaigns;
- provider aliases, Google send-as management, Microsoft shared/delegated mailboxes, and
  application mailbox permissions;
- delivery receipts, read receipts, bounce ingestion, or a claim of final supplier delivery;
- PO transmission. It may later reuse the connection, encryption, queue, and audit primitives,
  but it needs its own document/recipient/artifact authorization slice.

## 16. Decisions for MG

**SIGNED OFF 2026-07-24 (MG): all twelve recommendations ratified as written.** MG read 16.1
through 16.12 and accepted every recommendation without modification. Each recommendation below
is now a contract for implementation. Any later change to one of these items requires a new
dated MG decision recorded here.

Every item below gates implementation. The recommendation becomes a contract only after MG signs
it off.

### 16.1 Who manages mailbox connections

**Recommendation:** owner and manager may connect, disconnect, set the default, and change
mailbox policy through `integrations.manage`. Planners may send but may not administer OAuth
grants.

### 16.2 Who may send RFQs

**Recommendation:** owner, manager, and planner may send through `procurement.manage`, only for
RFQs at locations they can currently access. Warehouse, finance, and viewer remain read-only for
this action.

### 16.3 Per-send mailbox override

**Recommendation:** default to `owner_manager_only`. Planners use the tenant's default mailbox.
Owner/manager may select another active same-tenant connection in the confirmation dialog.
Tenants can choose `disabled`, but not a planner override until a demonstrated workflow requires
it.

### 16.4 Shared and delegated mailbox support

**Recommendation:** release 2 supports only the directly authenticated mailbox. A customer may
connect a dedicated procurement user account. Defer aliases/delegation because they add
provider-specific authority and, for Microsoft, may require `Mail.Send.Shared`.

### 16.5 Delivery retention

**Recommendation:** retain terminal delivery snapshots and private generated artifacts for 24
months, permit a tenant-configurable shorter period, and delete token material immediately on
disconnect. Reconcile audit-log retention so body snapshots are not retained twice.

### 16.6 Ambiguous send outcome

**Recommendation:** use `delivery_unknown` and never automatically retry an ambiguous provider
call. Only owner/manager may initiate an explicit linked resend after checking Sent Items.
This trades occasional manual work for protection against duplicate RFQs.

### 16.7 RFQ document status

**Recommendation:** delivery state never changes RFQ status. Keep the current manual document
transition explicit and rename it if needed to avoid implying provider delivery. Revisit
document automation only after real tenant workflow evidence.

### 16.8 Same mailbox in multiple Chain tenants

**Recommendation:** prohibit one provider subject/mailbox from being active in more than one
Chain tenant by default. Allow an audited owner exception only if a real multi-company operator
requires it. This reduces accidental cross-company sending.

### 16.9 Message content retention shape

**Recommendation:** store the exact Chain-generated body and immutable artifact bytes/hashes, but
do not ingest or copy the mailbox's Sent message. This proves what The Chain generated without
turning the product into a mailbox archive.

### 16.10 PO email reuse

**Recommendation:** let PO-to-awarded-vendor email reuse this security spine in a later,
separately gated slice. Do not include it in release 2 and do not infer PO authority from RFQ
send authority.

### 16.11 Release 3 consent and schedule

**Recommendation:** keep reply recognition off by default, request Google `gmail.readonly` or
Microsoft `Mail.Read` only through incremental re-consent, and schedule Google restricted-scope
verification plus independent assessment before committing to a release-3 date.

### 16.12 Provider rollout order

**Recommendation:** build the provider-neutral queue first, then Google, then Microsoft, with
allowlisted design partners and separate gates. Do not wait for both adapters to finish before
testing the security boundary, and do not call either provider generally available before its
production registration and consent experience pass review.
