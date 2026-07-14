# The Chain: Next Session Kickoff Prompt (Inventory Core Hardening)

*Written 2026-07-06 from a full codebase + schema audit. This file IS the prompt: paste it
(or point the agent at it) to start the session. It is self-contained and assumes the agent
has no prior context.*

---

## How to use this file

Say: **"Read docs/NEXT_SESSION_KICKOFF_PROMPT.md and let's start."** Then the agent should
follow the Session Protocol below. MG decision points are marked ⛔ MG DECIDES. Do not
build past a ⛔ without asking.

---

## THE PROMPT

You are working on **The Chain**, a multi-tenant inventory management SaaS at
`projects/the-chain/` (inside the More Technologies folder; the path contains a space, so
quote it in shell commands). Stack: Next.js App Router + React 19 + Tailwind 4 on Vercel,
Supabase Postgres with RLS, Workflow DevKit for durable orchestration, a Python
statsforecast function for forecasting, Stripe billing. Owner: MG, a career supply chain
professional. Strategic frame: **inventory is the CORE module** of a future modular
supply-chain platform (purchasing, logistics, maintenance modules attach to it later), and
the product also feeds MG's supply chain consulting business.

### Read these first, in this order (do not skip)

1. `docs/WAVE2_SCOPE.md` — Wave 2 contents, sequenced, plus locked decisions.
2. `docs/WAVE2_W2-0_MODE_SPINE_DESIGN.md` — the operating-mode spine; §10 is the W2-2
   storeroom migration spec you will implement.
3. `docs/OPERATOR_EVAL_2026-06-27_WAVE2_PLAN.md` — MG's hands-on eval that drove Wave 2.
4. `SYSTEM_DESIGN.md` — schema, contracts, RLS matrix, workflow orchestrations.
5. `_reviews/_tickets.md` — open tickets, including the deferred ledger header/line split.

### Verify real state before trusting anything (hard rule)

Run `git log --oneline -10` and `git status` in the project. As of 2026-07-06, `main` was
clean and contained: W2-0 mode spine (`tenants.operating_mode` + `src/lib/modes/` registry),
W2-1a product-supplier link import lane, W2-1b unit-of-measure dropdown. If you see newer
commits, re-scope against them: some items below may already be done. Also check Vercel
deploy state before claiming anything is live.

### Process constraints (non-negotiable)

- Follow the root `PROCESS.md` gates: each work item = build, screenshot evidence,
  MG review, code review, then push. Evidence goes in `_reviews/` with dated filenames.
- Respect the branch workflow: work on a feature branch; `main` auto-deploys. Never push
  to main without MG's go.
- Migrations are authored in-house against the real tables (partition-key and
  idempotency-index aware). Never hand migration SQL to an outside tool to generate.
- Every schema change gets RLS policies + audit trigger coverage + a cross-tenant probe
  test, matching the existing pattern in `supabase/migrations/`.
- No em dashes in anything MG-facing.

---

## WHY THIS SESSION EXISTS (audit findings, 2026-07-06)

A full architecture + schema audit found the foundation strong (append-only movement
ledger + per-location balances, rigorous forecast engine, mode spine, clean RLS) but
flagged four core gaps that block the "cross-industry inventory anchor" claim, plus two
carry-overs. The work below closes them, sequenced so nothing has to be redone.

The four gaps, ranked:

1. **No UoM conversion model.** W2-1b shipped a UoM dropdown, but operations buy in cases,
   stock in eaches, issue in eaches. W2-3 procurement (RFQ with vendor prices) will hit a
   purchase-UoM vs stock-UoM mismatch immediately. Must land before W2-3.
2. **No inventory valuation.** Cost lives only on `product_suppliers.unit_cost`. The system
   cannot answer "what is my inventory worth." A moving-average cost updated at receipt is
   the 80% answer; FIFO layers and landed cost stay deferred.
3. **No return flows.** The `stock_movement_type` enum has no return-to-vendor or
   customer-return types. Cheap to add while the enum is already being touched for W2-2.
4. **No stock status dimension.** No available vs quarantine/hold/damaged distinction.
   Receiving QC needs it in distribution; the food mode cannot exist without quarantine.

Carry-overs: password reset does not exist (live-customer-critical, already flagged in
`WAVE2_SCOPE.md` §4), and cycle-count variance does not auto-post to the stock ledger
(schema exists, no reconciliation write).

One architectural mandate: **formalize the inventory posting kernel.** The rule going
forward is that no module (purchasing, logistics, maintenance, cycle counts) ever writes
`inventory_levels` directly. Everything posts a movement through one service and balances
follow. `receive_purchase_order()` (migration `20260612180000`) already behaves this way;
this session makes it the stated, enforced contract so every future module inherits audit,
forecast input, and correctness for free.

---

## WORK ITEMS, SEQUENCED

Work them in order. Each is its own feature branch + gate. Do not start item N+1 while
item N awaits MG review unless MG says to parallelize.

### Item 0 — Password reset / auth recovery (small, do first)

Supabase Auth reset-password flow: request form, email link, update-password page, wired
into the existing `/(auth)` segment styling. Audit-log the reset event. This is a
prerequisite for putting any live customer on the product.

Acceptance: a user who forgot their password can recover the account end to end on
production without MG touching the database.

### Item 1 — W2-2 storeroom migration + movement-enum completion

Implement `docs/WAVE2_W2-0_MODE_SPINE_DESIGN.md` §10 exactly:

- Enum: add `issue_out`, `issue_return` to `stock_movement_type`.
- `stock_movements.demand_ref_type text null` + `demand_ref_id text null` (free-text
  work-order ref for now; intentionally NOT a FK).
- `stock_movements.reason_code text null`.
- `locations.location_kind text null` (`stockroom` now).
- Validation: `issue_out` requires demand ref + negative quantity; `issue_return` requires
  the same ref + positive quantity (app layer + CHECK).

AND, since the enum is being touched (audit additions, same migration):

- Add `return_to_vendor` (stock leaves, referenced to a PO or supplier) and
  `customer_return` (stock re-enters, distribution mode) movement types. UI can lag;
  the ledger vocabulary should be complete now to avoid a second enum migration.

⛔ MG DECIDES before building the UI slice: exact issue-out form fields and who can issue
(the minimal role slice pulled from original Wave 3, per `WAVE2_SCOPE.md` §4 W2-2).

Then build the W2-2 operator surfaces per the scope doc: issue-out action (single + bulk),
manual adjustment, cycle-count entry. **Cycle-count close must post `cycle_count`
movements through the posting kernel and update `inventory_levels`** (closes the
variance-reconciliation gap; the wired-for acceptance test in `SYSTEM_DESIGN.md` already
specifies this behavior).

Acceptance: MG can issue parts to a free-text work order, adjust stock with a reason code,
run a cycle count whose variance posts to the ledger, and see all of it in the audit log.
Storeroom-mode tenants forecast from `issue_out` demand (the mode spine's `demandSource`
already routes this).

### Item 2 — W2-2.5 inventory-core hardening (NEW slice, must precede W2-3)

**2a. UoM conversion.**

- `products.stock_uom` stays the canonical unit (current `unit_of_measure` column).
- Add purchase-UoM support on the supplier link: `product_suppliers.purchase_uom text null`
  + `purchase_to_stock_factor numeric null` (e.g. CASE with factor 12 means 1 purchase unit
  = 12 stock units). Null means purchase unit = stock unit, factor 1.
- PO lines order in purchase UoM; receipt converts to stock units when posting the
  `receipt` movement. The ledger and `inventory_levels` stay in stock UoM only, always.
- Extend the W2-1a import lane + product/supplier forms to carry the two new fields.
- Reuse the W2-1b unit registry (`src/lib/uom/`) for the dropdowns.

⛔ MG DECIDES: whether fractional stock quantities are allowed on conversion remainders,
or receipts must round to whole stock units per product (suggest: numeric, no forced
rounding, flag remainders in the receive UI).

**2b. Moving-average cost + inventory valuation.**

- Add `inventory_levels.avg_unit_cost numeric null` (stock-UoM basis).
- Update rule, inside the posting path only: on `receipt`,
  `new_avg = ((on_hand * old_avg) + (qty_received * receipt_unit_cost_in_stock_uom)) / (on_hand + qty_received)`;
  guard division by zero and negative on-hand (if on_hand <= 0, new_avg = receipt cost).
  All other movement types leave avg cost unchanged and are valued at current avg.
- Seed strategy for existing tenants: initialize from primary supplier
  `product_suppliers.unit_cost` converted to stock UoM, flagged as `seeded` provenance.
- Surface: an inventory valuation view (per SKU, per location, tenant total = on_hand *
  avg_unit_cost) on the inventory page + a CSV export. This is the "what is my inventory
  worth" answer.
- Explicitly deferred, do not build: FIFO cost layers, landed cost (freight/duty
  allocation), GL integration, three-way match. Note them in the doc trail so they are
  not lost.

**2c. Stock status dimension.**

- Minimal correct shape: add `inventory_levels.on_hold numeric not null default 0`
  alongside on_hand/allocated/in_transit, plus `hold` / `release` handling via
  `adjustment` movements with `reason_code` (`qc_hold`, `damage_hold`, `release`), or a
  dedicated movement pair if cleaner during implementation.
- Available-to-promise everywhere the engine reads position changes from
  `on_hand + in_transit - allocated` to `on_hand - on_hold + in_transit - allocated`
  (`src/lib/reorder/`, policy compute, dashboards). Grep for every position calculation;
  there must be exactly one shared helper for it afterward.

⛔ MG DECIDES: whether held stock still counts in valuation (suggest yes) and whether the
first release exposes hold/release in the UI or ships engine-only.

**2d. Formalize the posting kernel.**

- One TypeScript service (suggest `src/lib/inventory/post-movement.ts` wrapping a
  `post_stock_movement()` SQL function): validates type-specific rules (signs, required
  refs), inserts the movement, updates `inventory_levels` (including avg-cost and on-hold
  effects), fires audit. All writers migrate to it: receive RPC, cycle-count close, W2-2
  issue/adjust, CSV movement import commit, QBO sync movement writes.
- Enforcement: revoke direct `inventory_levels` writes from app paths (RLS already limits
  this; tighten so only the kernel path mutates balances), and add a test asserting ledger
  replay equals stored balances for a seeded tenant.
- Document the contract in `SYSTEM_DESIGN.md` (new "Inventory posting kernel" section):
  future modules (W2-3 procurement, logistics, maintenance) touch stock ONLY through this
  service. This is the anchor-point architecture decision.

Acceptance for Item 2: buy-in-cases/stock-in-eaches works end to end (PO in cases, receipt
posts eaches), the valuation view answers tenant inventory worth, held stock is excluded
from reorder position, and every balance mutation in the codebase flows through the one
posting service with a replay test proving ledger/balance agreement.

### Item 3 — W2-3 procurement (RFQ, requisition, PO) — only after Item 2

Per `WAVE2_SCOPE.md` §4 W2-3 and the operator eval Scenario A: RFQ to one or multiple
vendors (user's choice per RFQ, both from the start), capture returned vendor prices
(in purchase UoM, which now exists), requisition as an approvable document that becomes a
PO. New tables (rfqs, rfq_lines, rfq_vendor_quotes, requisitions, requisition_lines)
follow the existing header/line + RLS + audit pattern. This is the first true satellite
module on the inventory kernel: it must not write balances at all (only the PO receive
path posts, through the kernel).

⛔ MG DECIDES before this build: approval rules (who approves a requisition, single-step
or threshold-based), whether RFQs email vendors from the app or export for manual send,
and quote-to-line matching UX. Bring a short written design for sign-off first, like the
mode-spine doc.

### Backlog (tracked here so nothing is lost, NOT this session)

- W2-4 multi-location UI (location selector, transfer recommendations).
- Supplier price breaks (quantity-tiered `product_suppliers` pricing) — natural fast-follow
  once RFQ captures real vendor quotes.
- Lot/batch/expiry + FEFO (food mode deep build), bin/zone locations, barcode (Wave 4),
  ledger header/line split (trigger conditions in `WAVE2_W2-0_MODE_SPINE_DESIGN.md` §10),
  FIFO costing, landed cost, GL/three-way match, returns UI surfaces, Rutter (Wave 5),
  ROI dashboard (Wave 6).
- Design partner: still the biggest non-code gap. Every eval so far is MG evaluating his
  own product. One live storeroom or distributor tenant is worth more than any further
  schema work, and doubles as the consulting case study.

---

## SESSION PROTOCOL

1. Read the five docs listed at the top. Verify git/Vercel state.
2. Confirm with MG which item this session targets (default: lowest unfinished number).
3. For the target item: restate the scope in a few sentences, surface the ⛔ decisions
   that gate it, and get MG's answers BEFORE writing code.
4. Build on a feature branch with the normal gate (build, screenshot evidence in
   `_reviews/` with a dated filename, MG review, code review, push on MG's go).
5. Update `docs/WAVE2_SCOPE.md` status and `_reviews/_tickets.md` when the item lands.
6. End of session: write what shipped, what is pending, and the next action back into
   this file's Status section below.

## Status

- 2026-07-06: File created from the audit. Nothing below Item 0 started. Next action:
  Item 0 (password reset) or MG picks.
- 2026-07-07: **Item 1 (W2-2 storeroom) ⛔ decisions LOCKED with MG** (resolve the "MG DECIDES
  before building the UI slice" gate). Build the issue-out slice to these:
  1. **Who can issue = owner + manager + warehouse.** App-layer allowlist in the issue-out Server
     Action (same pattern as reorder/PO actions: verify `tenant_role` ∈ set, then call the
     SECURITY DEFINER posting RPC as system). Planner is OUT (replenishment planning ≠ physical
     issue). Only owner is UI-exposed today; this wires the gate for Wave 3 roles.
  2. **Demand reference = user picks the TYPE.** A dropdown (Work order / Crew / Cost center)
     writing `demand_ref_type`, plus the free-text `demand_ref_id`. This ENRICHES the migration
     spec §10 default (which hardcoded `demand_ref_type='work_order'`): allow all three values.
     Update the CHECK/app validation to accept the three types (still: issue_out requires
     demand_ref_type + demand_ref_id + negative qty; issue_return the same ref + positive qty).
  3. **Optional form fields = reason code + note.** Reason-code dropdown
     (maintenance / repair / scrap / other) → existing `reason_code` column; plus an optional
     free-text note. Required baseline stays SKU + location + quantity + demand ref.
  Everything else in Item 1 (enum adds issue_out/issue_return/return_to_vendor/customer_return,
  location_kind, cycle-count-close posting through the kernel) is unchanged from the doc above.
- 2026-07-07: **Item 0 BUILT on `feature/item0-password-reset` (local, not pushed) — at the
  MG-review gate.** Full flow: /forgot-password request form (enumeration-safe),
  /api/auth/confirm (token_hash + PKCE code, open-redirect guard), /reset-password update form,
  auth.password_reset audit row, forgot link on /signin. Verified end to end against the real
  Supabase auth backend with a throwaway user (created, recovered, new password sign-in OK,
  deleted). 19 tests; suite 717/717; tsc/biome/craft clean. Build evidence:
  `_reviews/2026-07-07_item0_password_reset_evidence.md`; Codex review + decisions:
  `_reviews/2026-07-07_item0_password_reset.md`. Production deploy notes (in the evidence file):
  Supabase redirect-URL allowlist entry + recommended token_hash email template + optional
  `NEXT_PUBLIC_SITE_URL`. Codex round-1 fixes applied in-slice: confirm route is recovery-only,
  origin derived from a trusted URL (not the spoofable Host header), audit insert/profile errors
  logged not swallowed. Next action: MG reviews the Codex findings/decisions, then push on MG's
  go. After that: Item 1 (W2-2 storeroom migration), whose ⛔ (issue-out form fields + who can
  issue) needs MG's answers before the UI slice.
- 2026-07-07 (later): **Item 0 SHIPPED TO PRODUCTION.** Full gate ran: MG review → Codex review
  (fixes in-slice) → MG push go → fast-forward merge to main (`97bdfe7..f1c18b6`) → Vercel
  production deploy Ready → routes probed live (200s on /forgot-password + /reset-password; bad
  confirm link bounces to the expired notice; apex→www redirect preserves the token query). MG
  configured the Supabase side: redirect allowlist entry + token_hash Reset Password template.
  Item 1 ⛔ decisions are locked above. **Next action: start Item 1 (W2-2 storeroom migration +
  enum completion) on a fresh feature branch.**
- 2026-07-07 (night): **Item 1 (W2-2 storeroom) BUILT on `feature/item1-w2-2-storeroom`
  (local, not pushed) — at the MG-review gate.** Two migrations (enum completion:
  issue_out/issue_return/return_to_vendor/customer_return; §10 columns + CHECKs +
  demand-ref index; inventory_op_events idempotency ledger with RLS + audit; three atomic
  posting RPCs: issue / adjustment / cycle-count close). Demand is now mode-routed
  (storeroom forecasts + classifies from issue_out) via src/lib/modes/demand.ts. Surfaces:
  Issue selected (bulk bar, issue-archetype modes) + Adjust + /inventory/cycle-counts count
  sheet whose close posts variances through the RPC. Live-verified end to end on a seeded
  storeroom tenant (scripts/seed-storeroom-demo.mjs): WO-tagged issues, damage adjustment,
  count close reconciling drift, all in audit. 17 new tests; suite 734/734; tsc/biome/craft
  clean. Evidence: `_reviews/2026-07-07_item1_w2_2_storeroom_evidence.md` (includes 3 review
  flags + the prod-migration-state deploy checklist item). Next action: MG walkthrough +
  review, then Codex review, then push/merge with prod migrations on MG's go.
- 2026-07-08 (end of night): **Item 1 through the FULL gate except merge.** MG walkthrough
  round 1 (2 findings fixed: count-sheet SKU autocomplete, legible audit rows) + Codex
  round-1 (count-close idempotency ordering bug fixed, action-boundary tests added, renames,
  doc sync). Branch `feature/item1-w2-2-storeroom` PUSHED (3 commits, `e7098b1` tip). Suite
  755/755. **MERGE IS PENDING and gated on a prod finding: production Supabase is missing 4
  migrations** (verified against the real schema, not the record): block11b_approve_receive_stock
  + alerts_engine (skipped by the June 28 deploy — PROD RECEIVE IS BROKEN until applied; the
  deployed app calls the 5-arg receive RPC that does not exist there) + the two W2-2
  migrations. **NEXT ACTION: on MG's go, apply the 4 migrations to prod (order: block11b,
  alerts_engine, w2_2a, w2_2b), re-run the schema probes, fast-forward merge to main, probe
  the deploy.** MG declined to run it tonight; nothing merged, main untouched. After that:
  Item 2 (W2-2.5 inventory-core hardening), whose ⛔s (fractional stock on conversion
  remainders; held stock in valuation; hold/release UI vs engine-only) need MG before build.
- 2026-07-09: **Item 1 SHIPPED TO PRODUCTION.** MG go received. The 4 missing prod migrations
  applied in order via Supabase MCP (block11b_approve_receive_stock, alerts_engine,
  w2_2a_movement_enum, w2_2b_storeroom_ops); post-apply schema probes all green (5-arg
  receive RPC live, old 4-arg dropped; all alerts + storeroom RPCs, both idempotency tables,
  4 enum values, 5 columns present); security advisor zero new findings. Fast-forward merged
  `d29b227..9d50726` to main, pushed; Vercel production Ready, www.thechainmanagement.com
  aliased; smoke probes pass (/, /pricing, /signin 200; webhook GET 405; anonymous /inventory
  serves the signin gate). PROD RECEIVE FIXED.
- 2026-07-09 (same session): **Item 2 (W2-2.5) ⛔ decisions LOCKED with MG:**
  1. **Fractional stock quantities ALLOWED on conversion remainders.** Numeric, no forced
     rounding; the receive UI flags remainders (the doc's suggested shape, MG confirmed).
  2. **Held stock COUNTS in valuation** (you still own it), and is EXCLUDED from reorder /
     available-to-promise math (position = on_hand - on_hold + in_transit - allocated).
  3. **Hold/release ships WITH UI in W2-2.5** — engine and UI together, not engine-only.
  Build opened on `feature/item2-w2-2-5-core-hardening` off main `9d50726`.
- 2026-07-09 (end of night): **Item 2 (W2-2.5) BUILT END TO END, at the MG checkpoint.**
  Branch `feature/item2-w2-2-5-core-hardening`, 2 commits (`97d82f0` feat + `1ec5e81`
  Codex round-1 fixes), LOCAL ONLY — MG deferred the push decision to next session.
  Shipped in the slice: 3 migrations (w2_2_5a hold/release enum; w2_2_5b core — the
  post_stock_movement() POSTING KERNEL, record_stock_movements() balance-neutral
  ingestion door, purchase_uom + factor, avg_unit_cost + provenance, on_hold, valuation
  views, every RPC reposted through the kernel, member RLS writes dropped on
  inventory_levels/stock_movements; w2_2_5c import-link RPC), netPosition() single ATP
  helper, UoM end to end (link form / import lane / receive conversion rail with
  FRACTIONAL flag), ValuationStrip + valuation CSV export, hold/release UI. Suite
  809/809, tsc/biome/craft clean, Codex round-1 run + fixes landed
  (`_reviews/2026-07-09_item2_w2_2_5.md` with Decisions;
  evidence `_reviews/2026-07-09_item2_w2_2_5_evidence.md`). Live-verified on the
  storeroom demo tenant (mg-store@local.test / StoreroomDemo1 — BLT-M12-50 carries a
  posted cost and 5 held units, staged for the walkthrough).
  **NEXT ACTION — the first decisions of the next session, MG's words:**
  1. Push the branch to origin? (then/or walkthrough first)
  2. Wave-2 feature-contract home: kickoff doc as contract vs backfill FEATURES.md.
  3. Confirm or veto: in_transit commitment stays a kernel-surface function
     (apply_po_approval) rather than posting through post_stock_movement.
  Then the merge gate on MG's go: apply the 3 W2-2.5 migrations to prod IN ORDER
  (a → b → c, the FINAL files), re-probe the prod SCHEMA (not the record), ff-merge,
  probe the deploy. Also still unconfirmed: the Stripe live-card acceptance (asked
  2026-07-09, no answer yet).
- 2026-07-11: **The three deferred decisions ANSWERED by MG:**
  1. **Branch pushed to origin** (`feature/item2-w2-2-5-core-hardening`, tip `3b1d3de`,
     now tracking).
  2. **FEATURES.md is the Wave-2 feature-contract home.** Wave 2 section backfilled into
     `FEATURES.md` (W2-0, W2-1, Item 0, W2-2, W2-2.5 as-built contracts; W2-3, W2-4
     forward contracts). This kickoff doc stays the session log, not the contract.
  3. **in_transit stays a kernel-surface function (`apply_po_approval`) — CONFIRMED for
     now; MG reserves the right to veto later.** Natural revisit point: W2-3 procurement
     (the next flow touching in_transit).
  Remaining before merge: MG walkthrough of Item 2 on the storeroom demo tenant, then
  the merge gate above on MG's go. Stripe live-card acceptance still unanswered.
- 2026-07-12: **Item 2 (W2-2.5) SHIPPED TO PRODUCTION.** MG walked the demo tenant
  (valuation strip, hold/release, CSV export — all passed; the receive conversion rail
  could not be walked because the demo seed has no POs; it stands on the 07-09 live
  verification + the memorable RTL tests) and gave the go. Merge gate executed: 3
  migrations applied to prod in order (w2_2_5a → w2_2_5b → w2_2_5c, final files) via
  Supabase MCP; post-apply schema probes ALL GREEN (12 kernel-path functions with
  correct signatures incl. 8-arg link_supplier, hold/release enum values, 5 new
  columns, 3 valuation views, the 3 member-write policies dropped, all CHECKs present
  across partitions); security advisor ZERO new findings (same 5 pre-existing WARNs);
  fast-forward merged `9d50726..7df9ee8` to main + pushed; Vercel production Ready
  (`the-chain-1j4rzp2pc`); smoke probes pass (/, /pricing, /signin, /inventory 200;
  webhook GET 405; valuation export 401 to anon). **The posting kernel is now the
  enforced prod contract.** NEXT = Item 3 (W2-3 procurement): bring the short written
  design for MG sign-off first (approval rules, RFQ send vs export, quote-to-line UX
  are the ⛔s). Follow-ups carried: demo seed should gain a case-packed PO so the
  conversion rail is walkable; Stripe live-card acceptance still unanswered.
- 2026-07-12 (later): **Stripe live-card acceptance DEFERRED by MG — off the board, do
  not ask again.** MG understands the trade (real charge, refund loses the Stripe fee);
  the first real customer signup effectively runs it. **Item 3 (W2-3) ⛔ decisions
  LOCKED with MG via the design doc `docs/WAVE2_W2-3_PROCUREMENT_DESIGN.md` (signed off
  2026-07-12):** single-step approval (owner + manager, no self-approval, thresholds =
  Wave 3), export-for-manual-send (email-from-app = fast-follow ticket), comparison-grid
  quote UX with per-line picks. Build proceeds per the doc's §10 slice order on a fresh
  feature branch: migration slice first (5 tables + RLS + audit + zero-balance-writes
  probe).
- 2026-07-13: **Item 3 (W2-3 procurement) REVIEW-CLEAN and pushed to the MG merge gate.**
  Full adversarial review found and fixed tenant-unsafe parent FKs, non-atomic award
  creation, approval bypass through direct PostgREST updates, missing PO-line UoM/factor
  snapshots, ignored quoted MOQ, and incomplete supplier-link refresh/current checks.
  Award and decision now use row-locked database RPCs; conversion locks its source lines,
  fans out idempotently, and preserves immutable conversion snapshots through PO approval
  and receipt. Clean local DB reset replayed every migration. Suite 879/879; TypeScript,
  Biome, craft, and diff checks green. Evidence:
  `_reviews/2026-07-13_item3_w2_3_review_finish_evidence.md`. **NEXT ACTION belongs to MG:**
  walkthrough the branch, apply the six W2-3 migrations to production in filename order,
  re-probe production schema/security, fast-forward merge to main, and probe the deploy.
  Nothing was applied to production and main was not touched.
- 2026-07-13: **Item 3 (W2-3 procurement) SHIPPED TO PRODUCTION after MG authorization.**
  Applied all six reviewed migrations to Supabase project `hdpivaufoqokeuzgftsj` in exact
  order. Production probes confirmed six RLS-enabled tables, 24 policies, six audit triggers,
  tenant-scoped lineage constraints, snapshot checks, and SECURITY INVOKER functions with no
  balance references. Security Advisor refreshed at zero errors with the same five pre-existing
  warnings. Fast-forwarded and pushed main at `0058367`; Vercel deployment
  `dpl_8GVxfDbmGWoivvALRZw7DVmzGUNP` reached Ready. Canonical route, auth-gate, unauthorized
  export, and Stripe webhook method-gate smoke checks passed. Full evidence:
  `_reviews/2026-07-13_item3_w2_3_review_finish_evidence.md`.
