# Wave 2 fast-follow decisions for MG (2026-07-15)

Branch: `codex/w2-fast-follows`

These are decision briefs only. Neither feature is implemented on this branch. Production and
`main` remain unchanged.

## Decision 1: RFQ re-award policy

Current behavior permits another award while an RFQ remains open, producing another independent
draft requisition.

### Option A: keep the current behavior

- Lowest implementation cost and preserves operator flexibility.
- Multiple live requisitions can represent competing decisions from one RFQ, with no explicit
  indication of which one supersedes another.
- Approval and PO conversion remain safe individually, but the business history becomes ambiguous.

### Option B: one-award lock

- After the first successful award, the RFQ cannot be awarded again.
- Clearest operational rule and smallest durable implementation. It prevents accidental duplicate
  approvals and PO fan-out from the same sourcing event.
- Corrections require canceling the requisition and starting a new RFQ, even when the quotes are
  still valid. That adds operator friction and discards useful sourcing continuity.

### Option C: versioned re-awards

- Each re-award creates an immutable requisition version linked to the version it supersedes.
- Preserves the full award history, supports legitimate corrections, and makes the current award
  unambiguous. Superseded drafts cannot be submitted, approved, or converted.
- Highest implementation and migration cost. It needs version and supersession fields, an atomic
  re-award RPC, lifecycle guards, UI history, and conversion tests.

### Recommendation

Choose **Option C, versioned re-awards**. Procurement decisions benefit from immutable history, and
the product already treats quote lineage and approval trails as authoritative. A one-award lock is
simple but makes a normal correction unnecessarily destructive. Until Option C is approved and
built, keep the current behavior rather than partially imposing a lock.

**MG decision required:** A, B, or C. No re-award code will be changed before the pick.

## Decision 2: email RFQs from the app

### Proposed provider and boundary

Use **Resend** behind a small application-owned mail adapter. Server Actions call the adapter, and
only the adapter knows Resend's API. RFQ export remains available as a fallback. Sending is a
document communication action and must never touch inventory balances or movements.

### Sender and reply model

- `From`: one verified product subdomain controlled by MG, such as
  `The Chain RFQs <rfq@mail.thechainmanagement.com>`.
- `Reply-To`: a tenant-configured, verified procurement inbox. Replies go to the tenant, not to a
  shared product mailbox.
- Recipient: the supplier contact selected for the RFQ. The send surface must show the final To,
  From, and Reply-To values before confirmation.
- Tenant customization should be limited initially to display name and reply-to. Per-tenant From
  domains should wait until there is enough demand to justify domain onboarding and verification.

### Delivery and audit state

Add a tenant-scoped RFQ delivery table rather than overloading RFQ status. Each attempt records RFQ,
supplier, recipient snapshot, sender snapshot, reply-to snapshot, provider message id, requested by,
requested at, final state, and failure detail. Resend webhooks update delivered, bounced, or failed
state through a verified webhook handler. The table requires RLS, the house audit trigger, idempotent
send keys, and a cross-tenant probe. RFQ lifecycle stays independent: a transient email failure does
not roll back or silently change the sourcing document.

### MG configuration required

1. Choose and create the sending subdomain.
2. Add Resend's DNS records and wait for domain verification.
3. Create production and preview API keys and store them in the matching Vercel environments.
4. Configure the production webhook signing secret and endpoint.
5. Confirm the default display name and shared From address.
6. Confirm whether tenant reply-to addresses are trusted member-entered values or require an email
   verification loop. Recommendation: require verification before first send.

**MG sign-off required:** provider, sending subdomain, shared From identity, reply-to verification
policy, and delivery-state scope. No email integration will start before those choices and credentials
exist.

## Playwright page-flow assessment

Defer the browser page-flow ticket. A trustworthy test here needs more than adding one package: the
repo has no Playwright dependency or config, no reusable authenticated storage state, no browser-test
tenant lifecycle, and no deterministic browser fixture contract. The minimal correct wiring is a
Playwright config and browser install, a test-only login or saved-auth bootstrap, an isolated seeded
tenant reset, web-server orchestration on port 3100, cleanup, and CI artifact handling. Adding that
foundation plus two mutation-heavy page flows is larger than a fast-follow polish slice. The existing
jsdom interaction tests and database kernel probes remain green; wire Playwright as a dedicated test
infrastructure slice, then add `/inventory` hold/release and PO case-to-stock receive as its first two
specs.
