# Codex task: Email RFQ OAuth integration — Phase 0 security design (NO CODE)

Repo: `/Users/themoreapp/More Technologies/projects/the-chain` (or the cloud clone)
Branch: `codex/rfq-email-oauth` (already created off main `7ba2c3b`; work here)
Production: Vercel + Supabase `hdpivaufoqokeuzgftsj` — DO NOT TOUCH.

## What this is

The next locked build for The Chain: send RFQs to vendors by email FROM THE
CUSTOMER'S OWN MAILBOX (Google Workspace or Microsoft 365) connected via OAuth.
MG's recorded requirements are in
`_reviews/2026-07-15_w2_fast_follow_decisions.md` **Decision 2** — read it in
full first. It is the contract. Key points:

- Never send from a shared The Chain address. From/Reply-To = the connected
  customer mailbox; the message lands in that mailbox's Sent folder.
- OAuth only. No mailbox passwords collected or stored, ever.
- Export-for-manual-send stays a permanent universal fallback.
- Sending is a document communication action: it must NEVER write
  inventory_levels or stock_movements (kernel invariant).
- Recipient = the supplier contact selected for the RFQ. Send surface shows
  final To/From/Reply-To before confirmation.
- Delivery audit lives in its own tenant-scoped table (RLS + house audit
  trigger + idempotent send keys), never overloading RFQ status. An email
  failure never rolls back or mutates the sourcing document.
- Staged: (1) manual export exists today, (2) this release = OAuth connect +
  send + audit, (3) later = optional reply recognition, (4) any quote
  extraction is review-before-save, never authoritative on its own.

## Your deliverable (design only — no application code, no migrations applied)

Write `docs/EMAIL_RFQ_OAUTH_DESIGN.md` in the style and rigor of
`docs/WAVE3_W3-0_ROLE_SPINE_DESIGN.md` (read it for format: numbered sections,
explicit contracts, a final decisions section for MG). Cover at minimum:

1. **Provider architecture.** Google (Gmail API `gmail.send`) and Microsoft
   (Graph `Mail.Send`) behind one internal provider interface. Exact minimal
   scopes for release 2, and the additional scopes release 3 would need —
   justify every scope. App registration/verification requirements for each
   provider (Google verification for sensitive scopes, Azure app consent
   model) and what that means for rollout timing.
2. **Token storage and encryption.** Where refresh/access tokens live,
   encryption at rest (recommend a scheme: e.g. libsodium sealed box or
   pgsodium/Vault vs app-layer AES-GCM with a KMS-held key — compare, pick
   one, justify), key rotation story, and why the service role alone can read
   them. Tokens must never appear in logs, audit rows, or client payloads.
3. **Connection lifecycle.** Connect (who may: owner/manager only?), token
   refresh, provider-side revocation detection, tenant-side disconnect (what
   happens to queued sends), expiry handling, and re-consent. Mailbox
   ownership proof: the connected mailbox is the one OAuth authenticated —
   entering an address is never authorization (MG's rule).
4. **Tenant admin controls.** Default procurement mailbox selection, who may
   send, per-send mailbox override policy, and how this composes with the W3
   role spine (six roles) and W3-3 location scoping. Reuse the existing
   guarded-RPC + registry patterns from `src/lib/access/`.
5. **Delivery audit schema.** Full DDL sketch for the delivery-attempts table
   per Decision 2: RFQ, supplier, recipient snapshot, sender snapshot,
   provider + thread ids, requested_by/at, state machine
   (queued/sent/failed/...), failure detail, idempotent send key, RLS
   policies, house audit trigger, cross-tenant probe list.
6. **Send flow.** Server action → provider adapter contract, attachment
   generation (reuse the existing per-vendor CSV / `/print/rfq` letterhead
   artifacts), idempotency under retry, rate limits/backoff per provider,
   and the UI confirmation surface (final To/From/Reply-To). Explicitly state
   the zero-balance-writes invariant and how the design enforces it.
7. **Retention and privacy.** What message content we store (recommend:
   metadata + snapshot of what we generated, not the mailbox's copy), how
   long, what disconnect deletes, and what a tenant export/delete must cover.
8. **Threat model.** Token theft, cross-tenant send, confused-deputy via
   send-time mailbox override, replay of send requests, provider webhook
   spoofing (release 3), and the mitigations already implied above.
9. **Slice plan.** Break release 2 into buildable slices with per-slice test
   plans (real-DB probes like the W3 suites), gated the usual way.
10. **§ Decisions for MG.** Number every open product/policy decision (e.g.
    which roles may connect a mailbox; per-send override default; retention
    window; whether PO-to-awarded-vendor email rides this spine as a later
    slice). Give a recommendation for each. MG signs off before any build
    slice starts.

## Hard rules

- NO application code, NO new migrations, NO `supabase db reset`, NO database
  writes anywhere, NO pushes to main, NO prod access. Design doc + this
  branch only.
- Commit the design doc to `codex/rfq-email-oauth` and push that branch.
- If you find repo facts the design depends on (existing RFQ export routes,
  supplier contact fields, mode gating), read the code and cite file paths in
  the doc rather than assuming.

## After you finish

MG reviews §Decisions and signs off (the W3 pattern). Claude runs the
independent design audit ("where is the checkpoint") before slice 1 is
prompted. Loop: Codex builds → Claude reviews → MG gates → Claude verifies.
