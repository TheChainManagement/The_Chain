# Phase 5 Foundation — Codex full-weight review (2026-05-31)

Run: `codex exec` (codex-cli 0.131.0, ChatGPT account, read-only sandbox). PROCESS.md Hard Rule 9 gate before first GitHub push.

**Findings**

- **BLOCKER** `supabase/migrations/20260530121100_init_rls_policies.sql:24` + `supabase/migrations/20260530121200_init_auth_hook.sql:25` + `supabase/migrations/20260530121100_init_rls_policies.sql:86`  
  Any authenticated user can update their own `profiles.active_tenant_id` to any known tenant UUID, refresh the JWT, and the auth hook will emit that `tenant_id` even without a `tenant_members` row. Most “member” read policies only check `tenant_id = jwt_tenant_id()`, so this leaks products, inventory, POs, tenant_members, etc.  
  **Fix:** restrict `profiles.active_tenant_id` changes to a membership-verified RPC; add `WITH CHECK (active_tenant_id is null OR exists (... tenant_members ... auth.uid()))`; make the auth hook set `tenant_id`, `role`, and `token_generation` only when membership exists.

- **BLOCKER** `supabase/migrations/20260530121200_init_auth_hook.sql:29`  
  Removed members can regain read access after a fresh login/refresh: the hook still sets `tenant_id` from `profiles.active_tenant_id` even when `user_role is null`. Stale-token rejection catches the old token, but the new token becomes “current” and still passes tenant-only SELECT policies.  
  **Fix:** if no tenant_members row exists for `(active_tenant_id, uid)`, omit all tenant claims and clear/ignore `profiles.active_tenant_id`.

- **HIGH** `supabase/migrations/20260530120300_init_procurement.sql:54`, `supabase/migrations/20260530120400_init_forecasting.sql:31`, `supabase/migrations/20260530120500_init_operations.sql:30`  
  Child tables carry `tenant_id` but reference parent IDs globally, not tenant-scoped: `purchase_order_lines.po_id -> purchase_orders(id)`, `supplier_performance.po_id -> purchase_orders(id)`, `forecast_points/forecast_evaluations.forecast_id -> forecasts(id)`, `cycle_count_lines.session_id -> cycle_count_sessions(id)`. RLS allows inserts based on child `tenant_id`, so a tenant can create rows pointing at another tenant’s parent ID if known.  
  **Fix:** add `unique (tenant_id, id)` on parent tables and composite FKs like `(tenant_id, po_id) references purchase_orders(tenant_id, id)`.

- **HIGH** `supabase/migrations/20260531120000_audit_log_triggers.sql:106`  
  The audit dispatcher is single, but not complete for “every state change.” User-mutable tables such as `locations`, `departments`, `classification_thresholds`, `onboarding_state`, `cycle_count_sessions`, `cycle_count_lines`, `alerts`, and `notification_preferences` have mutation policies but are absent from the tracked array.  
  **Fix:** either audit every mutable table or explicitly make excluded tables system-only/non-state-changing. The SYSTEM_DESIGN contract says every state change writes audit.

- **HIGH** `src/app/(app)/layout.tsx:23`  
  The app gate checks only `getUser()`, not active tenant membership. A signed-in user with no valid active tenant still reaches the app shell, and this compounds the spoofed/stale active-tenant issue above.  
  **Fix:** resolve active tenant server-side in the layout: require valid `tenant_id`, `role`, `token_generation`, and a matching `tenant_members` row, otherwise redirect to onboarding/sign-in.

- **MEDIUM** `tests/foundation/rls-cross-tenant.test.ts:32` and `tests/foundation/rls-cross-tenant.test.ts:38`  
  The cross-tenant probe only tests SELECT and explicitly skips partition children. It does not prove direct access to `stock_movements_2026`, `stock_movements_default`, `audit_log_2026`, etc. is closed, nor does it probe cross-tenant INSERT/UPDATE paths.  
  **Fix:** include partition children or assert direct grants are revoked/RLS is enforced for them; add mutation probes for each policy class.

- **MEDIUM** `tests/foundation/role-matrix.test.ts:54`  
  The role-matrix probe covers a few headline cases, not every `(table, role, operation)` pair required by FEATURES.md. It would miss the profile active-tenant escalation, notification preference cross-tenant self access, and many unauthorized mutations.  
  **Fix:** generate assertions from the matrix for all tables, roles, and CRUD operations.

**Verdict: BLOCK**

---

## Round 2 (after hardening migration)

**Findings**

1. **HIGH, unresolved cross-tenant FK class remains**: the hardening migration fixes `purchase_order_lines`, `supplier_performance`, `forecast_points`, `forecast_evaluations`, and `cycle_count_lines`, but other tenant-scoped parent references are still global. Examples: `purchase_orders.recommendation_id` references `reorder_recommendations(id)` globally, `inventory_policy.based_on_forecast_id` references `forecasts(id)` globally, and sync tables reference `source_connections(id)` / `sync_runs(id)` globally. See [20260530120300_init_procurement.sql](/Users/themoreapp/More%20Technologies/projects/the-chain/supabase/migrations/20260530120300_init_procurement.sql:35), [20260530120400_init_forecasting.sql](/Users/themoreapp/More%20Technologies/projects/the-chain/supabase/migrations/20260530120400_init_forecasting.sql:66), [20260530120500_init_operations.sql](/Users/themoreapp/More%20Technologies/projects/the-chain/supabase/migrations/20260530120500_init_operations.sql:59). At least `purchase_orders` is user-mutable, so tenant A can attach a PO to tenant B’s guessed recommendation id.

2. **HIGH, gate is membership-any rather than membership-for-active-tenant**: [layout.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/layout.tsx:37) only requires any `tenant_members` row for the user. If a stale JWT still carries tenant A but the user remains a member of tenant B, the gate passes. The proxy stale-token RPC should catch normal traffic, but this gate is documented as primary protection and does not itself verify membership for the JWT tenant.

Bootstrap looks OK: `bootstrap_tenant` is `SECURITY DEFINER`, inserts membership before profile, and should not be broken by the new profile `WITH CHECK`.

Verdict: **BLOCK**.

---

## Round 3 — FINAL

No NEW or still-unresolved issues found. `inventory_policy.based_on_forecast_id` acceptance is reasonable given system-only mutation and no user write path.

Verdict: SHIP.

---

**Outcome:** 3 rounds. Round 1 BLOCK (2 blockers + 4 high/medium) → fixed. Round 2 BLOCK (2 high: remaining global FKs + gate scope) → fixed. Round 3 **SHIP**. All findings resolved or explicitly accepted (inventory_policy.based_on_forecast_id, system-only). The cross-tenant claim-minting hole and the partition-child side door were real and are closed + regression-tested (tests/foundation/claim-integrity.test.ts, rls-cross-tenant partition-child probe).
