# W3 Wave-Close TEST_KIT (seeded + pre-verified 2026-07-23)

One live test, zero setup. Local app against local Supabase. Prod is not touched by anything here.

## Start

```bash
npm run dev
```

Then open http://localhost:3100 (already verified running via the chain launch config).
Re-seed anytime (idempotent): `node scripts/seed-w3-testkit.mjs`

## Accounts (tenant: Gulf Coast Supply Co)

| Role | Email | Password | Scope |
|---|---|---|---|
| Owner | owner.kit@thechain.test | OwnerKit123! | All locations |
| Manager | manager.kit@thechain.test | ManagerKit123! | All (approver limit $5,000) |
| Planner | planner.kit@thechain.test | PlannerKit123! | All (auto-approve to $500) |
| Warehouse | warehouse.kit@thechain.test | WarehouseKit123! | Baton Rouge Yard ONLY |
| Finance | finance.kit@thechain.test | FinanceKit123! | All locations |
| Viewer | viewer.kit@thechain.test | ViewerKit123! | All locations |

Locations: Houston Hub (primary) + Baton Rouge Yard. 6 SKUs stocked at both.

## Pre-verified by Claude (browser, 2026-07-23)

- Owner sign-in → full rail, Owner badge, location scope selector with both sites.
- `/plan` renders live coverage: **80.8%, 572 of 708 units, $96 open PO commitment**.
- Warehouse sign-in → rail collapses (no Settings/Procurement/Forecasts/Integrations),
  WAREHOUSE badge, no location selector (single authorized site).

## Scenarios (in order, ~15 min)

1. **Owner — plan + team.** Sign in as owner. `/plan` shows 80.8% coverage and the
   gaps table. `/settings/team` shows all six members, warehouse scoped to Baton
   Rouge, your own row with no self-remove controls.
2. **Owner — provisional flow (W3-1).** From Team, create a provisional member
   (any email like temp.kit@thechain.test). Confirm the one-time password + Pending
   state. Optional: open a private window, sign in with it, walk the forced
   password replacement.
3. **Warehouse — scoping (W3-3).** Sign in as warehouse. Rail is collapsed,
   inventory shows only Baton Rouge stock. Tamper test: paste
   `/inventory?location=<Houston id>` — data stays fenced to Baton Rouge.
4. **Planner — auto-approve under limit (W3-5 + round-4 fix).** Sign in as
   planner. `/reorder` has 2 open recommendations. Submit the **PMP-CENT-1 pump**
   ($620 total, over your $500 limit) → requisition queues for approval, no PO.
   Then submit the **FLG-WN-4 flanges** ($350, under limit) → auto-approves
   straight to a linked PO. The flange supplier link has NO purchase UoM on
   purpose: before round 4 this conversion crashed; now it must succeed cleanly.
5. **Manager — approve (W3-0/W3-5).** Sign in as manager. Approve the queued
   requisition (within your $5,000 ceiling). Confirm the planner cannot approve
   their own submission if you try it from the planner account.
6. **Viewer/Finance — read-only lenses.** Quick sign-in each: viewer sees no
   action controls; finance sees billing under Settings.
7. **Tenant switch (W3-2), optional.** owner.kit has one tenant, so the switcher
   is hidden — correct behavior. (The switcher itself was browser-proven 2026-07-18.)

## What good looks like

Every rail matches the role, the warehouse member never sees Houston data, the
over-limit requisition waits for the manager, the under-limit one becomes a PO
instantly, and the UoM-less flange conversion completes without an error toast.
