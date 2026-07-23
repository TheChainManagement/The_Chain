# The Chain checkpoint review

LAST_REVIEWED: 2026-07-22

## Current checkpoint

W3-0 through W3-5 plus checkpoint fix rounds 1 through 3 are built on `codex/w3-role-spine`. W3-2 received a security review and
hardening pass; W3-3 adds database-enforced per-location assignments and Team controls; W3-4 adds
the shared live 30-day plan and role-emphasized `/today`; W3-5 adds owner-configured requester
automatic approval and human approver ceilings over the existing requisition trail. The final
six-role production gate is next after the MG/Claude re-check.

## W3 checkpoint fix round 3 - 2026-07-22

- R3-F1 exempts only the already validated policy and human transition paths from the final
  decision-metadata guard in `enforce_requisition_update()`.
- Ordinary authenticated PATCHes still cannot set `decided_at` or `approved_by_user_id`.
- The same guard now protects `rejection_note`; only the validated human/policy paths or the
  explicit return-to-draft clearing path can change it.
- Direct authenticated PATCH probes cover all three protected decision fields.
- `20260722120000_w3_checkpoint_fix_round1.sql` was amended in place as required.

No migration was applied to any database. The permitted gate and expected Claude replay results
are recorded in `_reviews/2026-07-22_w3_checkpoint_fix_round3_evidence.md`. Production remains
`362137d`; the eight-migration merge gate remains closed pending the MG/Claude re-check.

## Claude independent re-check of fix round 3 - 2026-07-22: NO-GO (round 4, 1 product bug + 2 test bugs)

R3-F1 CONFIRMED FIXED: the guard exemption is correctly scoped, decisions work end to end,
the three forge probes hold, and the kernel suite went fully green. Deeper execution exposed
three new roots (16 red tests, rest cascades):

- R4-F1 (PRODUCT): `convert_recommendations_to_requisition` inserts (null purchase_uom,
  factor 1) when a supplier link has no purchase UoM, violating
  `requisition_lines_uom_factor_pair_check` - reorder conversion is dead for any tenant
  without purchase UoMs on links. Fix: keep the pair consistent (null/null + factor 1 for
  math only).
- R4-F2 (TEST): the B2 happy-path probe applies the PO as authenticated; the in-transit
  upsert is RLS-blocked for members BY DESIGN (kernel contract). Apply under the service
  role like production; keep the authenticated rejection half.
- R4-F3 (TEST): stale cross-tenant expectation - B1's tenant gate now correctly raises
  `requisition_creation_forbidden` before `active_location_not_found`. Update expectation,
  add an own-tenant/foreign-location variant.

Replay clean, tsc/biome/craft pass, 976/992 green. Verdict:
`_reviews/2026-07-22_w3_checkpoint_fix_round3_claude_verdict.md`. Round-4 prompt:
`_codex/FIX_W3_CHECKPOINT_ROUND4.md`. Prod stays `362137d`; merge gate closed. Round 4
should be the closing round: expectation is zero red tests at the next re-check.

## W3 checkpoint fix round 2 - 2026-07-22

- R2-F1 keeps `submit_requisition()` SECURITY INVOKER and replaces its service-only location
  helper call with caller-pinned `can_access_location(uuid)`.
- R2-F2 adds `lock_member_requisition_authority()`, a narrow SECURITY DEFINER helper with an empty
  search path, JWT tenant pinning, self-or-owner/manager visibility, current membership reads, and
  the authority row locks that authenticated INVOKER RPCs cannot take directly. Submit and decide
  consume the helper while retaining their inline gates.
- R2-F3 implements MG-confirmed Option A. Reorder conversion now creates and submits a requisition
  through the W3-5 authority policy. Within-authority requests auto-approve and create a linked PO;
  other requests queue for human approval with no PO. The B2 approval-evidence gate therefore has
  no reorder exemption.
- `20260722120000_w3_checkpoint_fix_round1.sql` was amended in place because it has never reached
  production or main.

The prompt forbids applying migrations to any database, so this round is not claimed as verified
against a replayed schema. Static checks and the migration-independent suite are recorded in
`_reviews/2026-07-22_w3_checkpoint_fix_round2_evidence.md`. Production remains `362137d`. Stop here
for the MG/Claude replay and re-check.

## Claude independent re-check of fix round 2 - 2026-07-22: NO-GO (round 3, one small blocker)

Claude replayed the amended migration (clean `supabase db reset`) and ran the full real-DB
suite. All three round-2 asks are CONFIRMED FIXED: R2-F1 (caller-pinned location check),
R2-F2 (`lock_member_requisition_authority` definer lock helper; submit/decide stay INVOKER),
R2-F3 (Option A verified - reorder conversion rides the requisition spine, PO only on
auto-approval, no B2 exemption, UI routes correctly). tsc/biome/craft pass; zero-balance
invariant intact.

Remaining: 27 tests red in 5 files, ONE root - R3-F1: the round-1
`enforce_requisition_update` tail guard raises `decision_metadata_guarded` on the
sanctioned policy/human transitions (it lacks the `v_policy_transition`/`v_human_transition`
exemption), so every auto-approval and human decision fails. Round-1 permission blockers had
masked it. Fix is a few lines. Verdict:
`_reviews/2026-07-22_w3_checkpoint_fix_round2_claude_verdict.md`. Round-3 prompt:
`_codex/FIX_W3_CHECKPOINT_ROUND3.md`. Prod stays `362137d`; merge gate closed.

## W3 checkpoint fix round 1 - 2026-07-22

- B1 binds authenticated requisition inserts to `auth.uid()`. Direct creation also requires the
  actor to equal the caller and be a current member of the selected tenant.
- B2 uses the approval-evidence contract: `apply_po_approval()` requires a linked current,
  converted requisition with immutable human or system decision evidence for every caller.
- B3 whitelists requisition lifecycle edges, transaction-gates conversion, and clears decision and
  policy evidence when a rejected request returns to draft.
- B4 re-reads current membership roles on transfer, storeroom, cycle-count, and reorder
  service-role paths, with database event-seam enforcement for inventory operations and transfers.
- B5 restores `submit_requisition()` and `decide_requisition()` to SECURITY INVOKER while keeping
  their inline tenant, membership, role, location, and authority checks.
- Low-cost cleanup narrows requisition-authority reads to self or owner/manager, sets
  `set_primary_location` to `search_path = ''`, and permits either transfer endpoint to grant read
  access.

Named B1/B2 regression coverage and deferred LOW tickets are recorded in
`_reviews/2026-07-22_w3_checkpoint_fix_round1_evidence.md`. No migration was applied to any
database. Production remains `362137d`. Stop here for the MG/Claude re-check.

## Claude independent re-check of fix round 1 - 2026-07-22: NO-GO (round 2)

Claude replayed the migration (`supabase db reset` clean through `20260722120000`) and ran
the real-DB probes Codex could not. Result: 24 failing tests in 3 procurement files, all
collapsing to two roots from the B5 SECURITY INVOKER revert:

- F1 (BLOCKER): `submit_requisition` calls `member_can_access_location`, EXECUTE-revoked
  from `authenticated` since W3-3 -> every authenticated submission dies with permission
  denied. Fix: use caller-pinned `can_access_location(uuid)`.
- F2 (BLOCKER): `for share of m, a` locks in submit/decide require UPDATE privilege;
  `authenticated` is SELECT-only on `tenant_members` + the authority table. Fix: narrow
  definer lock helper pinned to the JWT tenant.
- F3 (HIGH, MG decision): the B2 gate makes reorder-converted POs permanently unapprovable
  (they carry no requisition). Option A = route reorder conversion through the W3-5 policy
  spine (recommended); Option B = documented system-PO exemption.

B1/B2/B3/B4 designs verified CORRECT and stand; tsc/biome/craft/build pass; zero-balance
invariant intact; 965/989 tests green. Verdict:
`_reviews/2026-07-22_w3_checkpoint_fix_round1_claude_verdict.md`. Round-2 fix prompt:
`_codex/FIX_W3_CHECKPOINT_ROUND2.md`. Prod stays `362137d`; the merge gate stays closed.

## Prior W3-5 gate

Local migration replay, 140-file/980-test suite, TypeScript, Biome, craft, production build, and
authenticated W3-5 desktop/mobile browser probes are green. Exact policy, security, and audit
results are recorded in `_reviews/2026-07-20_w3-5_approval_policy_evidence.md`.
Round-1 migration replay and the new real-DB probes remain for the MG/Claude re-check because this
fix run was explicitly prohibited from applying migrations to a database.

## Claude independent verification — 2026-07-18 (commit 90db636)

VERDICT: ON TRACK. Re-ran the whole gate from scratch, did not trust the report.
- Clean `supabase db reset`: all migrations replay in order through
  `20260718130000_w3_3_location_assignments.sql` (harmless idempotent drop-policy NOTICEs on
  inventory_levels/stock_movements insert/update, already removed by the W2-2.5 kernel migration).
- tsc clean, biome clean (358 files), craft PASS, `vitest run` 137 files / 962 tests green.
- Read both new migrations + the changed server actions in full. W3-2 hardening real and correct:
  switch now audits (destination tenant only, no prior-tenant leak) + FOR UPDATE profile lock;
  direct anon/authenticated/service_role ACLs revoked across the whole W3-0..W3-2 callable spine
  (revoking PUBLIC alone was insufficient — genuine gap Codex caught in my build); billing read
  gated to owner/finance + portal to owner; QuickBooks setup requires integrations.manage.
- Same-password finding (mine) is properly closed: HMAC(userId, provisionId, tempPassword) stored
  HttpOnly at provisional sign-in; activation rejects when the new password's HMAC matches. Temp
  password still never persisted.
- W3-3 model verified: `member_can_access_location` reads membership tables NOT the JWT (stale token
  can't preserve access); RLS rewritten across locations/inventory/movements/classification/
  forecasts/policy/reorder/PO+lines+receipts+performance/cycle counts/RFQ tree/requisitions/
  transfers; service-role posting paths gated app-layer — transfers/reorder/storeroom via explicit
  `memberCanAccess*`, cycle-counts via RLS-bound writes + an RLS-visible-session gate before the
  service-role close; contract triggers cover owner/manager-always-all, last-active-assignment, and
  location-archive-strands-a-member. Guarded `set_tenant_member_location_access` mirrors the W3-0
  hierarchy (self/privileged/cross-tenant blocked). Kernel invariant intact: the location RPCs touch
  only tenant_members/tenant_member_locations, zero balance writes.
- Probes are substantive (not hollow): cross-location read isolation, URL-shaped point-read denial,
  owner-always-all, manager-scoping + self/privileged/cross-tenant rejection, final-assignment guard,
  direct-write RLS denial.

FLAGS for MG (none blocking): (1) managers are FORCED company-wide (all_locations), a stricter read
than design §6's "managers default to all locations" — confirm if managers should be scopable later.
(2) scoped members do NOT see tenant-wide (location_id IS NULL) forecast/classification aggregates —
deliberate, product call. (3) reorder GENERATION stays tenant-wide for a scoped planner (idempotent
engine work; reads still RLS-gated). Codex-noted follow-ups: orphan provisional-identity janitor,
expiry-as-terminal-state, a switch-refresh-disruption browser test.

PROD NOTE: prod still `362137d`; the eventual MG merge gate applies SIX W3 migrations in order
(w3_0 20260717120000 → w3_1 20260717133000 → w3_2 20260718120000 → w3_2_hardening 20260718123000 →
w3_3 20260718130000 → w3_4 primary-location atomicity 20260718140000), then re-probe schema +
advisor.

LIVE SCOPED-MEMBER WALKTHROUGH — DONE 2026-07-18 (Claude drove, console clean throughout). Tenant
"Gulf Yard Co" (comped), two seeded sites North Warehouse (WIDGET-A 500 / WIDGET-B 120) + South Yard
(40 / 300). (1) All-location warehouse baseline: scope selector lists both sites, inventory = combined
540 / 420. (2) Owner scoped the warehouse member to North only via the W3-3 Team "Location access"
control (Selected locations → North). (3) Scoped warehouse re-login: the location-scope selector
DISAPPEARS (one authorized site) and inventory collapses to North only (500 / 120) — South's 40/300
invisible. (4) URL-tamper `?location=<South id>` still renders North only — RLS denies, param ignored.
## W3-4 build checkpoint — 2026-07-18

- `/plan` is live and role-readable with one timestamped 30-day demand-coverage calculation over
  authorized locations: no-double-count supply, committed due incoming, explicit forecast-quality
  exclusions, zero-demand honesty, denominator/scope, value/commitment, and top SKU/location gaps.
- `/today` remains one tree and selects the signed owner/manager, planner, warehouse, finance, or
  viewer emphasis. Drill-downs preserve the authorized location; no new mutation surface exists.
- Review hardening fixed the pre-existing non-deferrable primary-location unique-index race and an
  unauthenticated child-render query race. Both fixes are recorded in the dated evidence.
- Final branch-state gate: 139 files / 970 tests; TypeScript, Biome (365 files), craft, 59-page
  production build, clean migration replay through `20260718140000`, and authenticated desktop +
  390px owner walkthrough console-clean.

NEXT = W3-5 owner-configured auto-approval modes, requester limits, and approver routing; then the
six-role production gate.

## Claude independent verification — 2026-07-18 (W3-4, commit 0fce472)

VERDICT: ON TRACK. Re-ran the whole gate from scratch; did not trust the report.
- Clean `supabase db reset` replays every migration through `20260718140000_w3_4_primary_location_atomicity.sql`.
- tsc clean, biome clean (365 files), craft PASS, `vitest run` 139 files / 970 tests green.
- Read `src/lib/plan/compute.ts` in full vs design §9. Formula faithful: coverage =
  min(available+confirmedIncoming, demand)/demand aggregated across authorized SKU-location pairs,
  capped 100; available = netPosition - in_transit floored (excludes held/allocated AND avoids
  double-counting approved supply that already sits in inventory_levels.in_transit); confirmed
  incoming = committed-PO remainder due before the exclusive 30-day horizon end; open PO commitment =
  all remaining purchase qty x snapshot cost regardless of horizon; zero forecast demand -> coveragePct
  null ("No planned demand"), missing forecast -> dataQualityCount (NOT zero demand); unvalued gaps
  split out when avg cost null; tenant-wide (location_id null) forecast maps only to the primary
  authorized location; fractional purchase-to-stock factors pass through (only null/0 fall back to 1).
- Compute tests are substantive (not hollow): double-count prevention (66.67% case), newest-forecast +
  tenant-to-primary, usable-zero vs missing, draft/terminal/beyond-horizon exclusion, fractional UoM.
- `/plan` reads via the RLS-bound server client and gates on the tenant claim before querying, so
  W3-3 location scoping composes (a scoped member's plan sums only authorized sites). `/today` role
  emphasis derives from the same snapshot. No new write/Server Action surface -> kernel invariant
  intact, zero balance writes.
- Bonus fix verified: `set_primary_location` atomicity migration splits the one-primary handoff into
  clear-old-then-set-new under a location-set FOR UPDATE lock, fixing a latent W2-4 non-deferrable
  partial-unique-index race. This REDEFINES a PROD-LIVE W2-4 function (strictly safer); it rides to
  prod with the W3 batch. Also fixed: an unauth render race on /plan + /today (now verify tenant
  claim first).

FLAGS for MG (none blocking; Codex-documented product notes): (1) tenant-wide forecast only maps to
the primary authorized location -> a scoped member without the primary in their set gets no
tenant-wide-forecast demand for those SKUs; (2) inventory value can be incomplete when moving-average
cost isn't seeded (unvalued-gap units surfaced separately); (3) mobile bench rail remains vertically
heavy (pre-existing, deferred to a shell pass).

PROD NOTE: the eventual MG merge gate now applies SIX W3 migrations in order (w3_0 20260717120000 ->
w3_1 20260717133000 -> w3_2 20260718120000 -> w3_2_hardening 20260718123000 -> w3_3 20260718130000 ->
w3_4 20260718140000), and that batch INCLUDES the set_primary_location W2-4 race fix. NEXT = W3-5
(owner-configured auto-approval modes + requester limits + approver routing), then the six-role
production gate.

## W3-5 build checkpoint — 2026-07-20

- `tenant_member_requisition_authority` gives every existing/new member one explicit requester mode
  and optional independent human approver ceiling. Default remains approval-required; only an owner
  may mutate the audited row through `set_member_requisition_authority()`.
- `submit_requisition()` is the sole authenticated submission transition. It row-locks the current
  document, costed lines, member, and policy; recomputes total; and either queues or makes a system
  approval with no human approver plus the complete immutable audited snapshot/reason.
- `decide_requisition()` now uses current membership, W3-3 location access, and the member's
  inclusive ceiling. Direct decision/submission bypasses and submitted total/line edits are closed;
  the original self-approval guard remains unchanged.
- Team exposes owner-only request mode, automatic limit, and eligible-approver ceiling controls.
  Requisition detail explains the recorded audit reason. Authenticated owner walkthrough proved a
  real $480 request auto-approved inside a $1,500 limit at desktop and 390px, console-clean.
- Final branch-state gate: 140 files / 980 tests; TypeScript, Biome (366 source files), craft,
  59-page production build, and clean migration replay through
  `20260720120000_w3_5_requisition_approval_policy.sql`.

NEXT = MG/Claude independent W3-5 checkpoint, then the six-role/stale-session production gate and
the ordered Wave 3 migration batch. Production remains untouched.

PROD NOTE: the eventual gate applies SEVEN W3 migrations in order (w3_0 20260717120000 → w3_1
20260717133000 → w3_2 20260718120000 → w3_2_hardening 20260718123000 → w3_3 20260718130000 → w3_4
20260718140000 → w3_5 20260720120000). This batch includes the W3-4 `set_primary_location` race fix.
