# Item 1: W2-2 storeroom migration + operator surfaces — build evidence (2026-07-07)

Branch: `feature/item1-w2-2-storeroom` (not pushed; awaiting MG review per the gate).
Scope: kickoff Item 1 (`docs/NEXT_SESSION_KICKOFF_PROMPT.md`) = mode-spine §10 migration +
enum completion + W2-2 operator surfaces, built to MG's three locked ⛔ decisions
(owner/manager/warehouse issue; user-picked demand-ref type; reason code + note).

## Schema (two migrations, applied + tested locally)

- `20260707200000_w2_2a_movement_enum.sql` — adds `issue_out`, `issue_return`,
  `return_to_vendor`, `customer_return` to `stock_movement_type`. Separate file because
  Postgres cannot USE an enum value in the transaction that adds it.
- `20260707200100_w2_2b_storeroom_ops.sql` —
  - `stock_movements`: `demand_ref_type` / `demand_ref_id` / `reason_code` / `note`
    (note added for MG's locked reason-code + note decision; header-level concept, lifts
    cleanly to the deferred event header). CHECKs: issue_out needs ref + negative qty;
    issue_return needs ref + positive qty; ref type ∈ work_order|crew|cost_center;
    return_to_vendor negative; customer_return positive. Partial index on
    (tenant, demand_ref_type, demand_ref_id, occurred_at) for "what did WO-X consume".
  - `locations.location_kind` (open set; 'stockroom' now).
  - `inventory_op_events` — operator idempotency ledger (issue / adjustment /
    cycle_count_close), unique (tenant, key), RLS select-only + audit trigger. Named to
    stay clear of the deferred header/line split's reserved names.
  - Three atomic RPCs in the Block 11b receive style (idempotency claim first, movements +
    `inventory_levels` move together): `post_issue_movements` (one consuming object, N
    lines; kit = N rows sharing the ref), `post_stock_adjustment` (signed delta, reason
    required), `close_cycle_count_session` (reconciles each counted line to on_hand AT
    CLOSE under the level row lock, posts the delta as a `cycle_count` movement, stamps
    `last_counted_at`, records report variance vs expected, completes the session). These
    are the posting-kernel prototypes Item 2d unifies.

## Engine: demand is now mode-routed

`src/lib/modes/demand.ts` (archetype → demand movement types; sell → sale, issue →
issue_out; produce fails loud). Wired into all three demand reads: forecast batch
(`batch-core.ts`), classification (`classify.ts`), forecast-detail history (`detail.ts`).
Bucketing is |qty|, so issue rows' negative sign never reaches the math. Storeroom-mode
tenants now forecast + classify from issue_out demand (the W2-2 acceptance line).

## Surfaces

- **Ledger bulk bar** grows the operator affordances: "Issue selected" (issue-archetype
  modes only, per the spine) and "Adjust" (single selection). Both open the OperatorPanel:
  shared consuming-object fields (type dropdown per MG's decision + reference + reason +
  note) over per-line qty inputs with a live on-hand → after preview. Idempotency key
  minted per panel-open, so a double-click replays as a no-op.
- **/inventory/cycle-counts** — session list + "Start a count"; the session page is a
  count sheet (SKU + counted qty, enter, next; case-insensitive SKU match; expected
  snapshots at entry) with signed, color-coded variance, and "Close session & post
  variances" prints a reconciliation receipt (lines / variances posted / units
  reconciled). After close the sheet becomes the variance report.
- Inventory page title follows the mode label (storeroom tenants see "Storeroom").

## Live walkthrough (dev server, storeroom tenant, screenshots taken in-session)

Fixture: `scripts/seed-storeroom-demo.mjs` (kept in-repo so MG can run the same
walkthrough: mg-store@local.test / StoreroomDemo1, "Bayou Maintenance Co", 6 MRO SKUs).

1. Signed in → nav badge STOREROOM "demand from issues"; ledger titled Storeroom.
2. Selected BRG-6204 + SEAL-PMP-3 → Issue selected → Work order WO-10482, reason
   Maintenance, note "Pump 3 rebuild, night shift", qty 4 + 1 (after-preview showed
   48→44, 12→11) → posted. Ledger refreshed to 44 / 11.
3. DB: two `issue_out` rows (−4, −1) tagged work_order/WO-10482 with reason + note; one
   `issue` op event (summary: 2 lines, 5 total); audit rows for movements + level updates
   + the op event.
4. Adjust on GRS-EP2: −2, reason damage, preview 60→58 → posted; ledger 58.
5. Cycle count: started a session (redirects to the sheet), counted glv-ntr-l at 33
   (expected snapshot 35, variance −2 in red) and BLT-M12-50 at 18 (variance 0), closed →
   title flips to "Variance report", entry form gone.
6. DB after close: `cycle_count` movement −2 (reason count_variance) for GLV only (the
   zero-drift line correctly posts NOTHING), on_hand 33, `last_counted_at` stamped on both
   counted lines, session `completed`, `cycle_count_close` op event (2 lines, 1 movement,
   2 units reconciled).

Acceptance check (kickoff Item 1): issue to a free-text work order ✓ (typed ref, per the
upgraded decision), adjust with a reason code ✓, cycle count whose variance posts to the
ledger ✓, all visible in the audit log ✓, storeroom forecasts from issue_out ✓ (demand
routing + unit tests).

## Tests

- `tests/storeroom/rpcs.test.ts` (13) — real local schema: enum values, all five CHECKs,
  issue happy path + replay no-op + issue_return + validation errors, adjustment + replay
  + validation, count close (reconcile-at-close semantics, report variance vs expected,
  re-close refused, nothing-counted refused, level-row creation for first-count products).
- `tests/modes/demand.test.ts` (4) — demand routing incl. default + fail-loud produce.
- Foundation probes re-run green: the catalog-driven cross-tenant RLS probe auto-covers
  `inventory_op_events`; audit-trigger suite green.
- Full suite 734/734 (was 717). tsc clean, biome clean, craft guard PASS.

## Flags for MG review (not blockers, want your eyes)

1. **Issuing can drive on_hand negative** (by design: the part physically left even if the
   system thought there were fewer; counts reconcile drift, they don't block work). If you
   want a hard floor or a warning instead, say so.
2. **Adjustment reasons** shipped as damage / shrinkage / found / correction / other; issue
   reasons as maintenance / repair / scrap / other. Both easy to re-vocabulary.
3. **Distribution-mode tenants** get Adjust + Cycle counts but NOT the issue affordance
   (the spine's flowEvents). Flip a tenant to storeroom and it appears.

## Deferred (tracked, consistent with the kickoff)

- **issue_return / return_to_vendor / customer_return UI** — enum + CHECKs + RPC support
  shipped (issue_return is fully wired through the RPC); surfaces lag per kickoff Item 1
  ("UI can lag; the ledger vocabulary should be complete now").
- **Action-layer integration tests** for issueStock / adjustStock / count actions — the
  standing per-block deferral; the RPC layer beneath them is DB-tested.
- **Playwright screenshot artifacts on disk** — standing infra gap; in-session screenshots
  + this run log + the DB assertions stand in, per the repo's standing substitution.
- **Prod migration state check at ship**: `supabase migration list` shows `20260628140000`
  (W2-1a) applied locally but NOT recorded on the linked remote. Before merging Item 1 to
  main, verify prod carries W2-1a + these two migrations (apply via linked `db push` or
  MCP) — deploy checklist item, not a code gap.

## MG walkthrough round 1 (2026-07-08) — two findings, both fixed in-slice

MG ran the walkthrough himself (issue, adjust, count all worked live). Two findings:

1. **Count sheet had no SKU reference** — he had to leave the sheet to look up SKUs.
   Fix: the SKU field now autocompletes from the active catalog (datalist, SKU + name,
   capped at 2000). Deliberately never shows on-hand: a blind count stays blind. The
   bigger design question (pre-populated count sheets, count-by-area) is MG's to think
   on; parked for W2-4 / the count deep build.
2. **His count variance was invisible in the audit log.** Investigated: the rows were
   all there (RLS query as his user proved it) — the VIEWER rendered them as bare
   "Created Stock movement" headlines, so nothing identified itself as his count.
   Fix: audit rows now carry a one-line detail derived from the after snapshot
   ("count variance -2 · count_variance", "issue out -4 · work order WO-10482",
   "session completed"), rendered in the headline; W2-2 tables got proper labels
   (Count session / Count line / Operator event). Pure transform + 5 unit tests
   (`tests/audit/event-detail.test.ts`). Suite 739/739 after both fixes.

## Codex round-1 (2026-07-08) — full weight; fixes applied in-slice

Review + decisions: `_reviews/2026-07-08_item1_w2_2_storeroom.md`. Fixed in-slice:
- **Count-close idempotency bug (Codex's best catch):** the RPC checked terminal status
  before the idempotency claim, so a same-key retry after a successful close errored
  instead of replaying as a no-op. Claim now happens first (a raise still rolls it back);
  new replay-after-close test.
- **Action boundary now tested** (15 cases): the owner/manager/warehouse gate incl.
  planner/finance/viewer rejected before any write, validation, actor threading, RPC
  mapping. Converted the standing deferral into done for this slice.
- **Renames:** loadSaleMovements → loadDemandMovements; loadAllSales →
  loadAllDemandHistory (the names claimed sale-only, the behavior is mode-routed).
- **SYSTEM_DESIGN.md updated** to the real schema (10-type enum, demand-ref envelope,
  inventory_op_events + posting-RPC contract); **_tickets.md** gained the W2-2 deferred
  block.
Accepted (recorded in the decisions): screenshot-artifact harness (standing ticket; MG ran
the walkthrough personally this slice), prod migration reconciliation as a merge-gate
task, E2E audit-read test (ticketed). Suite 755/755 after fixes.

## Next

Codex round-1 complete, fixes in. Push/merge on MG's go, which includes the prod migration
reconciliation (W2-1a + the two W2-2 migrations) before main auto-deploys.
