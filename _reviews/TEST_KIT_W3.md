# TEST_KIT_W3: Wave 3 (role spine) wave-close live test

Covers: Wave 3, the role spine wave. Access spine (W3-0), provisional accounts (W3-1), tenant switch (W3-2), location assignments (W3-3), primary-location atomicity plus the shared /plan (W3-4), approval policy (W3-5), and the fix-round product fix (R4-F1, reorder conversion with a UoM-less supplier link).

Runs: Saturday 2026-07-25. Budget about 45 minutes for the 12 scenarios.

Written against: repo state of 2026-07-24. Branch `codex/w3-role-spine` tip `2253e17`, already ff-merged to `main` (see PART 0). Final Claude verdict: `_reviews/2026-07-23_w3_checkpoint_fix_round4_claude_verdict.md` (GO, FULL GREEN, 992 of 992 tests). All testing below is LOCAL (localhost:3100 against local Supabase). Nothing in the scenario section touches prod.

House rule: work top to bottom. Nothing below PART 0 runs until PART 0 is confirmed.

---

## PART 0: Merge gate (MG only, do FIRST)

**STATUS: THE MERGE GATE ALREADY RAN.** It was executed end to end on 2026-07-23 at 6:09 PM (commit `7ba2c3b`, "record W3 prod merge gate"). All 8 migrations were applied to prod `hdpivaufoqokeuzgftsj` in order via Supabase MCP, the schema probe came back green (3 new tables, 18 W3 functions, old `convert_recommendations_to_po` dropped), the security advisor showed only the intentional W3 DEFINER RPC entries, `codex/w3-role-spine` was ff-merged to main (`362137d..2253e17`) and pushed, the Vercel production deploy went Ready, and the live smoke was all 200s. Full record: `_agentic-os/projects/the-chain/CHECKPOINT_REVIEW.md`, section "W3 PROD MERGE GATE EXECUTED".

So PART 0 tomorrow is verification only. **Do NOT re-apply any migration.** Re-applying would error against the live schema.

Verify these four things (about 3 minutes):

1. Local repo is current and on main:
   ```bash
   cd "/Users/themoreapp/More Technologies/projects/the-chain"
   git checkout main && git pull
   git log --oneline -3
   ```
   **Expect:** tip at or past `7ba2c3b`, and `2253e17` (the W3 test kit commit) in history. Note: main may also show `841726a` (email RFQ design prompt, docs only, expected).

2. Prod migrations present. In a Claude session, ask Claude to run Supabase MCP `list_migrations` on project `hdpivaufoqokeuzgftsj`. **Expect** these eight, in this order, at the end of the list:
   1. `20260717120000_w3_0_access_spine.sql`
   2. `20260717133000_w3_1_provisional_accounts.sql`
   3. `20260718120000_w3_2_tenant_switch.sql`
   4. `20260718123000_w3_2_review_hardening.sql`
   5. `20260718130000_w3_3_location_assignments.sql`
   6. `20260718140000_w3_4_primary_location_atomicity.sql`
   7. `20260720120000_w3_5_requisition_approval_policy.sql`
   8. `20260722120000_w3_checkpoint_fix_round1.sql` (contains fix rounds 1 through 4, amended in place per protocol)

3. Vercel production deploy is Ready for the commit at main's tip (Vercel dashboard, the-chain project). (VERIFY BEFORE SESSION: the production domain is not hard coded in the repo, read it off the Vercel dashboard. The 7/23 smoke hit /, /pricing, /signin, /procurement, /inventory, /plan, /settings/team, all 200.)

4. Advisor re-probe (optional, already green 7/23): ask Claude to run Supabase MCP `get_advisors` (security) on `hdpivaufoqokeuzgftsj`. **Expect:** pre-existing WARNs unchanged, plus entries flagging the W3 SECURITY DEFINER RPC spine. Those are intentional and probe-tested, not findings.

If ANY of the four checks fails, STOP. Do not test. Ping Claude with what you saw.

---

## Setup (local, about 5 minutes)

Everything runs locally. Prod is not touched by anything below.

1. Terminal, from the repo root `/Users/themoreapp/More Technologies/projects/the-chain`:
   ```bash
   git checkout main
   supabase status
   ```
   If `supabase status` shows the stack is not running: `supabase start` (first run after a reboot takes a minute).
   If the local DB is in a weird state or you want a clean slate: `supabase db reset` (replays all migrations), then re-run BOTH seed scripts below.

2. Seed (idempotent, safe to re-run every time, run both):
   ```bash
   node scripts/seed-w3-testkit.mjs
   node scripts/seed-storeroom-demo.mjs
   ```
   The first prints a JSON summary (tenant id, location ids, the six users). The second creates the second tenant used by scenarios 11 and 12.
   If `node` is not found, use the pinned one: `export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"` first.

3. One-time SQL for the tenant switch scenario (gives owner.kit a second tenant membership, local DB only):
   ```bash
   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "insert into tenant_members (tenant_id, user_id, role, all_locations) select t.id, u.id, 'manager', true from tenants t, auth.users u where t.slug = 'bayou-maintenance' and u.email = 'owner.kit@thechain.test' on conflict do nothing;"
   ```

4. Start the app: `npm run dev` (or the "chain" launch config). Open http://localhost:3100

### Accounts (tenant: Gulf Coast Supply Co)

| Role | Email | Password | Scope |
|---|---|---|---|
| Owner | owner.kit@thechain.test | OwnerKit123! | All locations |
| Manager | manager.kit@thechain.test | ManagerKit123! | All (approver ceiling $5,000) |
| Planner | planner.kit@thechain.test | PlannerKit123! | All (auto-approve up to $500) |
| Warehouse | warehouse.kit@thechain.test | WarehouseKit123! | Baton Rouge Yard ONLY |
| Finance | finance.kit@thechain.test | FinanceKit123! | All locations |
| Viewer | viewer.kit@thechain.test | ViewerKit123! | All locations |

Second tenant (Bayou Maintenance Co, storeroom mode): mg-store@local.test / StoreroomDemo1

Locations: Houston Hub (primary) and Baton Rouge Yard. Six SKUs stocked at both. Two open reorder recommendations are pre-seeded (the flanges and the pump). One in-transit PO (W3KIT-PO-1) feeds /plan.

Pre-verified by Claude in the browser on 2026-07-23: owner full rail and both-site scope selector, /plan at 80.8 percent coverage (572 of 708 units, $96 open commitment), warehouse collapsed rail with no location selector.

---

## Scenarios (in order)

### 1. Owner: plan and team roster (W3-0, W3-4)
1. Sign in as owner.kit.
2. Open /plan.
3. Open /settings/team.

**Expect:** full rail with an Owner badge and a location scope selector listing Houston Hub and Baton Rouge Yard. /plan shows live coverage around 80.8 percent with the gaps table, open PO commitment, and confirmed incoming. /settings/team lists all six members, warehouse scoped to Baton Rouge Yard, and your own owner row has NO role-change or remove controls (self-mutation blocked, by design).

### 2. Owner: create a provisional member (W3-1)
1. Still as owner, on /settings/team, create a new member: email `temp.kit@thechain.test`, role Planner.

**Expect:** a one-time credential card with the email, a 20-character temporary password, and an expiry. Copy the password now, it is never shown again. The member appears under Pending access.

### 3. Provisional activation, fenced until replaced (W3-1)
1. Open a private/incognito window at http://localhost:3100/signin.
2. Sign in as temp.kit@thechain.test with the temporary password.
3. Before doing anything else, paste /today into the URL bar directly.
4. Go back to /activate-account and set a new password (different from the temp one).

**Expect:** sign-in lands on /activate-account, NOT /today. The direct /today attempt bounces you (no tenant claim yet, designed rejection). After setting the new password, you land on /today as a planner. Back in the owner window, refresh /settings/team: temp.kit moved from Pending to active member.

### 4. Warehouse: location scoping plus tamper test (W3-0, W3-3)
1. Sign in as warehouse.kit (main window is fine, sign the owner out).
2. Look at the rail, then open /inventory.
3. Tamper test: in the URL, paste `/inventory?location=<Houston Hub id>` (Houston's id is in the seed script's JSON output, or copy it from the owner's location selector URL in scenario 1).

**Expect:** rail is collapsed (no Settings, Procurement, Forecasts, or Integrations) with a WAREHOUSE badge and NO location selector (single authorized site, by design). Inventory shows only Baton Rouge stock. The tampered URL does NOT leak Houston data, everything stays fenced to Baton Rouge (designed rejection).

### 5. Owner: edit a location assignment (W3-3)
1. Sign in as owner.kit, open /settings/team.
2. On the warehouse.kit row, add Houston Hub to their location assignments. Save.
3. In a private window, sign in as warehouse.kit and confirm Houston stock is now visible and a location selector appears.
4. Back as owner, remove Houston Hub again (back to Baton Rouge only). Save.

**Expect:** both edits save cleanly, and the warehouse member's visible data follows the assignment in the same session (refresh the warehouse window after each change). Removing the LAST assignment while all_locations is off should be refused or forced through the proper widen path (designed guard, do not file).

### 6. Owner: primary-location flip (W3-4 atomicity fix)
1. As owner, open /settings/locations.
2. Set Baton Rouge Yard as primary. Confirm.
3. Set Houston Hub back as primary. Confirm.

**Expect:** each flip succeeds with no error, and at every moment exactly one location shows the primary marker. This exercises the atomic swap that replaced the old two-row race. Any constraint error toast here is a real bug.

### 7. Planner: over-limit request queues (W3-5)
1. Sign in as planner.kit, open /reorder. Two open recommendations are seeded.
2. Submit the PMP-CENT-1 pump recommendation (2 units at $310, total $620).

**Expect:** $620 is over the planner's $500 auto-approve limit, so a requisition is created and queued for approval. NO purchase order is created. This stop is by design, not a failure.

### 8. Planner: under-limit, UoM-less conversion auto-approves (W3-5 plus R4-F1 product fix)
1. Still as planner on /reorder, submit the FLG-WN-4 flange recommendation (10 units at $35, total $350).

**Expect:** $350 is under the $500 limit, so it auto-approves straight through to a linked purchase order. The flange supplier link deliberately has NO purchase UoM: before fix round 4 this exact conversion crashed with "Could not submit the purchase request." It must now complete cleanly, requisition line snapshots null UoM and null factor, totals correct ($350). If you see that error toast here, that IS a bug, file it.

### 9. Manager approves, planner cannot self-approve (W3-0, W3-5)
1. First, as planner.kit, open the queued pump requisition from scenario 7 and look for an approve control.
2. Sign in as manager.kit, open the same queued requisition, approve it.

**Expect:** the planner sees NO approve control on their own submission (self-approval blocked, by design). The manager (ceiling $5,000) approves the $620 requisition cleanly and it proceeds to a PO.

### 10. Viewer and finance lenses (W3-0)
1. Sign in as viewer.kit, click through /today, /inventory, /plan.
2. Sign in as finance.kit, open /settings.

**Expect:** viewer sees data but NO action controls anywhere (no submit, approve, edit, or import). Finance sees billing under Settings, and no procurement write actions.

### 11. Tenant switch (W3-2)
1. Sign in as owner.kit (who now has a second membership from Setup step 3).
2. Before switching, open any Gulf Coast product detail page and copy its full URL.
3. Use the tenant switcher in the chrome to switch to Bayou Maintenance Co.

**Expect:** the switcher is now visible (it hides for single-tenant users, that hiding is by design). After switching, the app re-renders as Bayou Maintenance Co in storeroom mode with a manager lens: none of the Gulf Coast SKUs, locations, or recommendations appear anywhere.

### 12. Cross-tenant isolation probe (W3-2, RLS spine)
1. While still switched into Bayou Maintenance Co as owner.kit, paste the Gulf Coast product URL you copied in scenario 11.
2. Switch back to Gulf Coast Supply Co and confirm everything from scenario 1 still looks right.

**Expect:** the pasted Gulf Coast URL returns not-found or an empty fenced view, NEVER the other tenant's data (designed rejection). Switching back restores the full Gulf Coast view. Any cross-tenant data bleed at any step in this kit is a stop-the-session bug.

---

## Known quirks, do not file as bugs

- Tenant switcher hidden when a user has exactly one tenant. By design (scenario 11 sets up the two-tenant case).
- Warehouse single-site members get no location selector. By design.
- Provisional activation may accept a new password EQUAL to the temporary one. Known low-severity finding from the 7/17 walkthrough, already logged, fix scheduled later. Do not re-file.
- Owner cannot change or remove their own row on /settings/team. Designed self-mutation block.
- Security advisor WARNs on the W3 SECURITY DEFINER RPCs in prod. Intentional, probe-tested spine.
- Members cannot write inventory_levels.in_transit directly (kernel contract W2-2.5). Production applies PO approval through the service-role seam. Invisible in normal UI use, listed here for completeness.
- The seeded /plan numbers (80.8 percent, $96 commitment) will drift as scenarios 7 through 9 create POs. Expected.

## Reset after testing

Local only, prod needs nothing.

1. Optional cleanup of the temporary member: as owner.kit, remove temp.kit@thechain.test from /settings/team.
2. Optional removal of the two-tenant membership:
   ```bash
   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "delete from tenant_members where user_id = (select id from auth.users where email = 'owner.kit@thechain.test') and tenant_id = (select id from tenants where slug = 'bayou-maintenance');"
   ```
3. Full wipe if wanted: `supabase db reset`, then re-run both seed scripts from Setup step 2. The fixtures are idempotent, so leaving everything in place is also fine.
4. Stop the dev server. Done.

## Filing results

Drop findings in the session with Claude as usual: scenario number, what you saw, screenshot if quick. Anything marked "designed rejection" above that instead SUCCEEDS is also a bug, file those too.
