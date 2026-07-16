# Wave 2 fast-follow decisions for MG (2026-07-15)

Branch: `codex/w2-fast-follows`

These decisions are recorded requirements. Neither feature is implemented on this branch.
Production and `main` remain unchanged.

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

### MG decision: Option C approved

MG approved **Option C, versioned re-awards**, on 2026-07-15. Each new award must create an immutable
requisition version linked to the version it supersedes. Only the current version may be submitted,
approved, or converted to purchase orders. The UI must show the version history and clearly identify
the current version. The implementation needs an atomic re-award RPC, lifecycle guards, migration,
cross-tenant coverage, and conversion/idempotency tests.

Until that complete contract is built, retain the current behavior rather than introducing a partial
lock.

## Decision 2: email RFQs from the app

### MG decision: customer-owned mailbox required

MG rejected sending vendor RFQs from a shared The Chain address. Vendors must see the message from
the customer's actual construction, distribution, or procurement mailbox. RFQ export and manual
send remain permanent universal fallbacks. Sending is a document communication action and must never
touch inventory balances or movements.

### Sender and reply model

- Connect Google Workspace and Microsoft 365 company mailboxes through OAuth. Do not collect or
  store mailbox passwords, and do not treat entering or uploading an address as authorization.
- Prefer a shared company procurement mailbox such as `purchasing@company.com`; permit an authorized
  employee mailbox when that is how the customer operates.
- `From` and `Reply-To` are the connected customer mailbox. The vendor reply returns to the same
  company inbox, and the sent message should appear in that mailbox's Sent folder.
- Recipient: the supplier contact selected for the RFQ. The send surface must show the final To,
  From, and Reply-To values before confirmation.
- Authorized tenant members choose the default procurement mailbox and may choose another connected
  mailbox at send time when policy permits.

### Delivery and audit state

Add a tenant-scoped RFQ delivery table rather than overloading RFQ status. Each attempt records RFQ,
supplier, recipient snapshot, customer sender snapshot, provider and thread identifiers, requested
by, requested at, final state, and failure detail. The table requires RLS, the house audit trigger,
idempotent send keys, and a cross-tenant probe. RFQ lifecycle stays independent: an email failure
does not roll back or silently change the sourcing document.

### Staged delivery contract

1. Keep the existing export-for-manual-send workflow for every tenant and mail provider.
2. First integrated release: OAuth mailbox connection, company-mailbox send, sent-message audit, and
   manual quote upload or quote-grid entry.
3. Later release: optional mailbox-read permission to recognize replies in the original thread and
   attach them to the RFQ.
4. Any automatic quote extraction remains review-before-save. A reply or attachment must never
   silently become authoritative pricing.

Implementation still requires a separate provider/OAuth security design for Google and Microsoft,
including token encryption, permission scopes, tenant administrator controls, disconnection, and
retention behavior.

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
