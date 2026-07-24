# Codex run prompt: Email RFQ release 2, Slice 1 (E0 code portion: OAuth protocol + secret boundary)

Paste this whole file into Codex. The contract for this feature is
`docs/EMAIL_RFQ_OAUTH_DESIGN.md`. MG ratified all twelve section 16 decisions on 2026-07-24
(sign-off block recorded at the top of section 16). Every recommendation in 16.1 through 16.12
is now binding. Read sections 3, 4, 5, 13, 14, 15, and 16 before writing any code.

## WORKSPACE PREFLIGHT (verify before touching anything)

- Repository: `TheChainManagement/The_Chain`, local path
  `/Users/themoreapp/More Technologies/projects/the-chain`
- Base: current `main`. Tip is `841726a` (ancestors include the W3 prod merge record `7ba2c3b`
  and the W3 TEST_KIT commit `2253e17`). Wave 3 is fully merged; prod is live on this history.
- Branch to create: `codex/emailrfq-e0`, cut fresh off `main`. Do NOT continue
  `codex/rfq-email-oauth` (that was the design-only branch) and do NOT reuse any W3 branch.
- Design doc landing: `docs/EMAIL_RFQ_OAUTH_DESIGN.md` is NOT on `main` yet. It lives on
  `codex/rfq-email-oauth`, and the section 16 sign-off block may still be an uncommitted
  working-tree change there. Your first commit on `codex/emailrfq-e0` is that doc: bring it over
  exactly as it stands in the working tree (with the dated sign-off block) and commit it before
  any other work.
- Sanity files that MUST exist before you start:
  `docs/EMAIL_RFQ_OAUTH_DESIGN.md` (working tree, with the section 16 sign-off dated 2026-07-24)
  and `supabase/migrations/20260722120000_w3_checkpoint_fix_round1.sql` (on `main`).
- If any mismatch, STOP and report; do not adapt.

## Standing rules (unchanged from every prior Chain slice)

- Work only on `codex/emailrfq-e0`. Do NOT merge to main, do NOT push main, do NOT touch
  production (Vercel or Supabase `hdpivaufoqokeuzgftsj`) in any way.
- Migrations are files only, never applied to any shared or remote database. Local
  `supabase db reset` replay is the verification path. New migrations take the next free
  timestamps after `20260722120000`.
- House conventions apply: SECURITY INVOKER plus inline gate convention for RPCs, RLS
  default-deny, tenant pinning, design tokens only (no hardcoded values), zero balance writes
  from document or communication paths, no em dashes or en dashes in any text you write.
- The full suite stays green. tsc, Biome, craft check, and production build all pass.
- Evidence per PROCESS.md Hard Rule 8: a dated `_reviews/` evidence file plus an entry in
  `_agentic-os/projects/the-chain/CHECKPOINT_REVIEW.md`, then stop for the MG/Claude re-check.
  No slice inherits production approval from a prior slice.

## MG prerequisites (NOT your work; do not attempt any of it)

Slice E0 in section 13 includes provider console work that only MG can do: creating the
development and production Google Cloud projects, OAuth clients, and consent screens; submitting
`gmail.send` sensitive-scope verification; registering the multitenant Entra application;
Microsoft publisher verification; and provisioning the managed KMS keys (separate development
and production keys per section 4.1). None of that blocks this slice. You code against
documented environment variable names and a KMS client interface with a deterministic test
fake. Never invent, commit, or hardcode any real client ID, client secret, or key material.

## Scope: the E0 code portion (section 13, Slice E0)

Section 16.12 orders the rollout: provider-neutral security boundary first, then Google, then
Microsoft. This slice builds the boundary. Build no send UI and no send capability.

Deliverables:

1. **Server-only envelope encryption module (section 4.1, 4.3).** Per-record 256-bit DEK,
   AES-256-GCM over the canonical token bundle, DEK wrapped by a KMS-held KEK behind a narrow
   client interface (real client plus test fake). Authenticated additional data binds
   `tenant_id`, `connection_id`, provider, provider subject, and format version so ciphertext
   cannot be transplanted across tenants or rows. Stored-record shape carries exactly the
   fields listed in section 4.1 (ciphertext, nonce, tag, wrapped DEK, KEK version, format
   version, safe token metadata, timestamps). Implement rewrap (old KEK to new KEK without
   decrypting the bundle) and an explicit allowlist of current plus previous key versions.
2. **OAuth connect protocol layer (section 5.2).** One-time server-side state record with
   high-entropy nonce, tenant ID, actor ID, provider, PKCE verifier, return path, and short
   expiry; the browser receives only the opaque state and a secure HttpOnly SameSite cookie.
   Callback validation: state consumed exactly once, origin, expiry, current membership, active
   tenant, and live `integrations.manage` (owner and manager only, per 16.1) before token
   exchange. Then issuer, audience, nonce, signature, and provider subject validation, with the
   OAuth-authenticated mailbox recorded as the only identity. A typed mailbox, tenant default,
   domain match, or admin claim never substitutes for provider proof (16.4).
3. **Provider adapters, exchange and refresh only (sections 3.1, 3.2, 4.3).** Implement
   `exchangeAuthorization` and `refresh` for Google and Microsoft behind the single
   `RfqMailProvider` interface from section 3.1. Request exactly the section 3.2 release 2
   scopes and parameters, nothing more; never request any section 3.3 release 3 scope.
   Normalize all provider errors to safe codes before they leave the server boundary. Refresh
   honors section 4.3: atomic bundle replacement only after provider success, retain a rotated
   Microsoft refresh token, and never overwrite a valid refresh token with an absent response
   field. A Google callback that yields no usable refresh path must not produce an activatable
   grant. `send` and `revokeBestEffort` exist on the interface but return a normalized
   `not_implemented` safe error; slices E3 and E4 own them.
4. **Redaction guard.** Access tokens, refresh tokens, provider response bodies, and provider
   headers never appear in logs, thrown errors, audit rows, client payloads, or error
   monitoring. Add a guard at the logging seam, not just discipline.
5. **Ops artifacts (docs, no console actions).** Write `docs/EMAIL_RFQ_E0_RUNBOOK.md` covering:
   redirect URI inventory (development and production), consent-screen text for both providers,
   the publisher and sensitive-scope verification plan with the section 3.4 constraints and the
   tenant allowlist requirement, the KMS key hierarchy (dev and prod KEKs, who holds unwrap
   permission per section 4.1), the environment variable contract, and the incident rotation
   procedure from section 4.3. This is the checklist MG executes for the prerequisites above.

Persistence note, be honest about the seam: section 13 assigns the metadata, secret, and
settings schema to Slice E1. Build this slice's modules against narrow persistence interfaces
with in-memory or fixture implementations for tests. If you judge that one minimal table (for
example the one-time OAuth state record) is genuinely unavoidable to satisfy this slice's test
gate, write it as a migration file, keep it to the minimum, and flag the judgment explicitly in
the evidence file. Do not pull the E1 connection or secret tables forward.

## Test gate (section 13, Slice E0; every item below gets named tests)

- OAuth state, PKCE, and nonce abuse: replayed state, reused state, expired state, state minted
  for another tenant or actor, missing or forged PKCE verifier, forged nonce, wrong callback
  origin, caller without live `integrations.manage`.
- Token log redaction: the guard provably strips token material and provider bodies from the
  logging and error paths.
- KMS additional-data binding: ciphertext transplanted across tenant, connection, provider,
  subject, or format version fails to decrypt.
- Unwrap denial: only the designated server-only callers reach unwrap; any other path is
  refused.
- Key rewrap: DEK rewrapped from old to new KEK without bundle decryption; the version
  allowlist accepts current plus previous and rejects retired versions.
- Refresh-token rotation: rotated Microsoft token retained, absent response field never
  clobbers a valid stored token, atomic replacement only after provider success, transient
  failure keeps the grant usable.
- Provider callback identity: wrong issuer, wrong audience, wrong nonce, wrong subject, and a
  refresh-less Google grant are all rejected; the recorded mailbox is always the provider-proved
  one.

Suite expectation: everything currently green on main stays green, plus the named tests above.
State in the evidence what you expect from a clean `supabase db reset` replay (if you added any
migration file) and a fully green `npx vitest run`. If you cannot run them, say so explicitly;
Claude replays and runs them at the re-check.

## Section 16 contract points binding this slice

- 16.1: only owner and manager, through live `integrations.manage`, may start or complete the
  connect flow. Planners never administer grants.
- 16.4: only the directly authenticated mailbox. No alias, shared, or delegated mailbox input
  anywhere in this layer.
- 16.8: design the state and grant records so one provider subject can be active in at most one
  tenant per provider; the hard enforcement lands with the E1 schema, but nothing you build may
  assume otherwise.
- 16.12: provider-neutral boundary first, Google before Microsoft, allowlisted rollout. Neither
  provider is generally available in this slice; nothing here is user-facing.
- Section 14 acceptance items that already bind: OAuth-only (no passwords anywhere), release 2
  scopes only, tokens never in logs, audit rows, client payloads, exports, or monitoring.

## Explicitly OUT OF SCOPE for this slice

- Slice E1: connection metadata, secret, and settings tables, RLS policies, lifecycle audit
  events, guarded connect/disconnect/default RPC surface, owner/manager UI.
- Slice E2: delivery queue, confirmation model, supplier contact selection, queue RPC.
- Slices E3 and E4: any actual send, MIME generation, Gmail or Graph send calls, workers.
- Slice E5: history UI, incident switch, metrics, retention job, tenant export/delete.
- Every section 15 deferral: mailbox reading, reply recognition, webhooks, quote extraction,
  arbitrary recipients, Cc/Bcc, aliases, shared or delegated mailboxes, receipts, PO
  transmission.
- Any provider console action, verification submission, or KMS provisioning (MG prerequisites).
- Any UI at all. This slice is server modules, tests, migrations as files at most, and docs.

## When done

Commit everything to `codex/emailrfq-e0` and push that branch only. Write the dated `_reviews/`
evidence file (per-gate probe results, the persistence-seam judgment if you made one, expected
replay and suite results) and add the Slice E0 entry to
`_agentic-os/projects/the-chain/CHECKPOINT_REVIEW.md`. Then stop for the MG/Claude re-check.
Loop: Codex builds, Claude reviews, MG gates, Claude verifies. Prod stays on the current main
history until every release 2 slice passes its own gate.
