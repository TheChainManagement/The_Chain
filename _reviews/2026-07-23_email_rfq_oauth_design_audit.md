# Email RFQ OAuth design — Claude independent audit

Date: 2026-07-23 (late)
Branch: `codex/rfq-email-oauth`, Codex commit `2ff6464` (single commit, doc only)
Production: untouched (`main` at `841726a` carries no code from this branch)

## VERDICT: ON TRACK — design is sound, ready for MG §16 sign-off

Codex respected the design-only contract exactly: one commit, one file
(`docs/EMAIL_RFQ_OAUTH_DESIGN.md`, 891 lines), no application code, no migrations,
no database access.

## What was audited

- **All 10 required sections present and substantive** (provider architecture,
  scopes, token encryption, connection lifecycle, tenant admin + role-spine
  composition, delivery-audit DDL, send flow, retention, threat model, slice
  plan, decisions).
- **Repo citations spot-checked and REAL:** the RFQ export route, print
  letterhead page, `qbo/crypto.ts` precedent, `roles.ts` capabilities
  (`procurement.manage` / `integrations.manage`), the audit-trigger token
  denylist, and `suppliers.contact` jsonb all exist as described. The design is
  grounded in the shipped code, not assumptions.
- **Decision 2 contract fully honored:** customer mailbox only, OAuth only,
  From = Reply-To = connected mailbox, export fallback permanent, delivery
  table independent of RFQ status, staged releases with read-scope deferred to
  release 3, review-before-save for any extraction, zero balance writes with
  before/after hash probes required.
- **Security posture is strong:** minimal scopes with official-doc citations,
  envelope encryption (per-record DEK + KMS-held KEK, AAD bound to
  tenant/connection) over the weaker QBO static-key precedent, service-only
  secret table with no authenticated policies, two-step INVOKER-authorization →
  service-enqueue seam (correctly reasoned: default-deny RLS means an INVOKER
  RPC cannot insert without granting a bypassable client policy),
  `delivery_unknown` over automatic resend for ambiguous provider outcomes,
  W3-3 location scoping composed throughout, 14-point probe list.
- **Honest operational realities:** Google sensitive-scope verification before
  rollout and restricted-scope assessment as a release-3 schedule gate;
  Microsoft `202`-without-message-id audit contract; provider rate limits
  treated as runtime responses.

## Build-time notes (non-blocking, for slice prompts)

1. §7 proposes `rfqs_tenant_identity unique (tenant_id, id)` — W2-3 composite
   FK hardening may already provide this. Slice E2 must check before adding.
2. §9.2 correctly forbids the worker fetching the authenticated export URL;
   the shared artifact-service refactor must be scoped INTO slice E2/E3, not
   deferred.
3. The audit-log double-retention issue for body snapshots (§7/§11.3) needs a
   concrete answer in the E2 migration (redact snapshot keys in capture_audit
   or move bodies to a separate payload table).

## NEXT

1. MG reads §16 (12 decisions, each with a recommendation) and signs off.
   The recommendations are all sensible defaults; 16.3 (override policy),
   16.5 (retention window), and 16.8 (same mailbox in two tenants) are the
   ones worth an actual opinion.
2. After sign-off, Claude writes the Slice E0 Codex prompt (provider
   registration + secret boundary). E0 also needs MG to create the Google
   Cloud / Entra app registrations — the prompt will include a checklist.
