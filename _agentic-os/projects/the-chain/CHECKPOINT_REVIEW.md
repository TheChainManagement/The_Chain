# The Chain checkpoint review

LAST_REVIEWED: 2026-07-18

## Current checkpoint

W3-0 through W3-4 are built on `codex/w3-role-spine`. W3-2 received a security review and
hardening pass; W3-3 adds database-enforced per-location assignments and Team controls; W3-4 adds
the shared live 30-day plan and role-emphasized `/today`. W3-5 owner-configured member spend policy
is next under the decision already locked in the Wave 3 design.

## Gate

Local migration replay, 139-file/970-test suite, TypeScript, Biome, craft, production build, and
authenticated W3-4 browser probes are green. Exact results and calculation decisions are recorded
in `_reviews/2026-07-18_w3-4_shared_plan_evidence.md`.

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
