# The Chain — Features
*Phase 4 artifact. Required by PROCESS.md.*
*Created: 2026-05-30. Revised: 2026-05-30 (post-Codex Beat 4: Foundation block + wired-for verification suite added, CSV rewritten as SourceAdapter, sales-ingestion criteria, edge cases, Phase 6 visible-craft gate on every block).*
*Re-entered whenever a new feature is added mid-project.*

> One block per Wave 1 feature in PRD scope. Each block is the contract Phase 6 builds against. The Codex review at every Phase 6 push pressure-tests the built feature against its block. Every block names a "What's memorable" element per the visible-craft bar (MG, 2026-05-30): every feature ships with a distinctive moment, not just design-token compliance. **Phase 6 gate: the memorable element must be visible in a preview screenshot or driveable by a Playwright interaction test before the feature passes review.**

**Wave 1 build order:**

0. **Wave 1 Foundation** (Phase 5 work — schema, RLS, adapter contract, workflows, auth, theme, app shell, CI probes, wired-for verification suite)
1. Account creation + sign-in
2. Tenant onboarding workflow
3. Master data — products + SKUs
4. Master data — suppliers + lead times
5. CSV import (`CsvSourceAdapter`)
6. QuickBooks Online integration (`QboSourceAdapter`)
7. ABC + XYZ classification
8. Demand forecasting pipeline
9. Inventory optimization (policy + DOS + stockout risk)
10. Supplier reliability scorecard
11. Reorder workflow + PO lifecycle
12. AI insights layer
13. In-app alerts
14. Audit log + retention tiers
15. Inventory health dashboard
16. Subscription + trial + billing wiring
17. Marketing site

---

## Feature: Wave 1 Foundation

**Why**: PROJECT.md "build philosophy" + PRD §"What gets wired into the architecture from day one" + SYSTEM_DESIGN.md — the schema, RLS, adapter contract, durable workflows, audit log triggers, auth scaffold, theme, and app shell are day-one architecture, not per-feature work. They must exist and pass tests BEFORE any Phase 6 feature work begins.

**Phase note**: This is Phase 5 (Foundation) work per PROCESS.md, codified here so the Phase 5 Codex review has an explicit acceptance contract to pressure-test against.

**Dependencies:** none. This is the first thing built.

**Step-by-step build sequence:**
1. **Database migration suite.** Create every table in SYSTEM_DESIGN.md §Database schema with the exact columns, types, defaults, constraints, and primary keys specified. Include partitioning for `audit_log` and `stock_movements` (RANGE on `occurred_at`, yearly partitions for 2026 + 2027). Include indexes from SYSTEM_DESIGN.md §Operational indexes.
2. **RLS policies suite.** Implement every policy in SYSTEM_DESIGN.md §RLS policy matrix using `auth.jwt() ->> 'tenant_id'` predicate + the `has_role(role_required)` helper. Wave 1 UI exposes only `owner` role, but every role's policy is in place from day one.
3. **Auth + JWT scaffold.** Wire Supabase Auth. Create the Supabase auth hook that embeds `tenant_id`, `role`, and `tenants.token_generation` into the JWT. Middleware refresh + stale-generation rejection.
4. **`SourceAdapter` TypeScript interface + canonical payload shapes.** Implement `packages/source-adapter/src/index.ts` per SYSTEM_DESIGN.md §Source-adapter contract. Zod schemas for every canonical payload (`product`, `supplier`, `product_supplier`, `purchase_order`, `inventory_level`, `stock_movement`). `Cursor`, `AdapterCapabilities`, `PullResult`, `PushResult`, `RetryableError`, `FatalError`.
5. **Workflow DevKit configured.** Install `workflow`, `@workflow/next`, `@workflow/ai`. Verify `npx workflow health` passes. Build one trivial end-to-end workflow as smoke test.
6. **Audit log triggers.** Postgres trigger (security-definer) on every tracked table (`products`, `purchase_orders`, `purchase_order_lines`, `inventory_levels`, `stock_movements`, `suppliers`, `product_suppliers`, `subscriptions`, `tenant_members`, `source_connections`, `reorder_recommendations`, `inventory_policy`, `sync_conflicts`). Trigger writes `audit_log` row with `before`/`after` jsonb capturing the columns required for Wave 6 ROI computation: for `inventory_levels` (`on_hand`, `allocated`, `in_transit`, `location_id`); for `purchase_orders` (`status`, `total`, `expected_delivery_at`, `actual_delivery_at`, `supplier_id`); for `stock_movements` (`type`, `quantity`, `product_id`, `location_id`, `occurred_at`).
7. **Theme provider + design token map.** `src/styles/globals.css` declares every CSS variable from DESIGN_DIRECTION.md. Tailwind config maps to them. No hardcoded values in any subsequent code.
8. **Base components.** `StatNumber`, `ClaudeInsight`, `ActionButton`, `Panel`, `ChainLink`, `MetricCell` built against tokens only. Each has empty / loading / error states. Each has Storybook stories + tests.
9. **App shell.** `(app)` layout with left rail + main work surface + right rail. Mobile collapse. Throughput hairline at bench bottom + today tick. Signal scan + scroll progress. Empty bench state.
10. **CI probes.** Cross-tenant RLS probe test for every table. Audit-trigger fires test for every tracked table. Source-adapter contract compile test. Workflow DevKit smoke test.

**Acceptance criteria:**
- [ ] Every table in SYSTEM_DESIGN.md exists with matching columns. Verified by a migration test that diffs schema against the SYSTEM_DESIGN tables list.
- [ ] Every RLS policy in the matrix is implemented. Verified by cross-tenant probe (logged-in as Tenant A, query every table for Tenant B's rows — must return zero) AND a role-matrix probe (logged-in as `viewer`, attempt every mutation on every table — must return PermissionDenied per the matrix).
- [ ] Audit log trigger fires on every tracked mutation. Verified by a test that mutates each tracked table and asserts a corresponding `audit_log` row exists with the required fields populated.
- [ ] `SourceAdapter` interface compiles + canonical payload zod schemas validate against handcrafted fixtures for every entity kind.
- [ ] Workflow DevKit smoke workflow runs end-to-end (`start` → `"use step"` round-trip → return value).
- [ ] Theme tokens accessible as CSS variables everywhere. CI lint fails any hardcoded color, font, or spacing in TSX or CSS.
- [ ] Base components render with empty / loading / error states. Each has at least one Storybook story + unit test.
- [ ] App shell + left rail + right rail + throughput hairline + scroll progress all render to the design.

**Codex review checklist:**
- [ ] Schema diff test catches a missing column or wrong type.
- [ ] Cross-tenant probe genuinely uses two distinct tenants via Supabase test JWTs.
- [ ] Role-matrix probe covers every (table, role) pair, not just the headline ones.
- [ ] No hardcoded values in any component or stylesheet (grep for `#[0-9A-F]{6}` and `font-family:.*['"]` returns only token-file matches).
- [ ] Workflow DevKit boundary respected in the smoke workflow (orchestrator is `"use workflow"`, I/O is in `"use step"`).
- [ ] Audit trigger handles tables added later via a single dispatcher function, not table-specific code duplication.

**Wired-for verification suite (per SYSTEM_DESIGN.md §Wired-for acceptance tests).** Each of the following must run green in CI as part of Foundation acceptance:
- [ ] **Multi-location activation (Wave 2 dry run):** seed two `locations` rows; assert `inventory_levels`, `stock_movements`, `recomputeForecast(productId, locationId)`, and `purchase_orders.location_id` all accept the second location without schema change.
- [ ] **Multi-user + role-based dashboards (Wave 3 dry run):** seed a `tenant_members` row with `role='finance'` and another with `role='planner'`; assert per the RLS matrix that finance can SELECT `subscriptions` + `audit_log` but cannot UPDATE `products`; planner can UPDATE `reorder_recommendations` + `purchase_orders` but cannot SELECT `subscriptions`. JWT carries the role.
- [ ] **Cycle counts + browser barcode (Wave 4 dry run):** insert `cycle_count_sessions` + `cycle_count_lines`; assert closing the session inserts `stock_movements` rows with `type='cycle_count'` and `inventory_levels.on_hand` updates correctly.
- [ ] **Rutter adapter (Wave 5 dry run):** implement a mock `RutterSourceAdapter` conforming to `SourceAdapter`. Assert `pull()` produces identical downstream state as the QBO path; capability flags gate UI features automatically.
- [ ] **ROI dashboard (Wave 6 dry run):** query `audit_log` for any tenant with seeded mutation history within the tier hot window. Assert `before`/`after` JSONB on `inventory_levels`, `purchase_orders`, and `stock_movements` rows contains the deltas required to compute stockout reduction, inventory reduction, expediting cost, and payback.
- [ ] **Distribution-ERP natives (Wave 7+ dry run):** implement a mock `Cin7SourceAdapter`. Assert same contract works with no canonical schema changes; capabilities surface correctly.
- [ ] **Pricing model swap (any time):** set `subscriptions.status` through `trial`, `active`, `comp`. Assert gating logic accepts all three with no code change.
- [ ] **Tier-gated retention (any time):** set `subscriptions.retention_tier` from `starter` to `pro` to `enterprise`. Assert UI and `/api/exports/audit/[period].csv` immediately expose the wider window without partition movement.

**What's memorable:** The Foundation block doesn't ship a visible feature — it ships **trust**. The CI cross-tenant probe + role-matrix probe + wired-for verification suite all run green on a single command, and the report is a single ASCII page showing every guarantee as a checked box. When MG runs `npm run verify:foundation`, the output reads like a daylight engineering inspection sheet, not a wall of test names. (Required visible artifact: the verify:foundation command output, captured as a screenshot in the Phase 5 evidence trail.)

---

## Feature: Account creation + sign-in

**Why**: PRD §"Feature list" — Account + auth, the entry surface for self-serve sign-up + 14-day trial default.

**Dependencies:**
- Other features: Wave 1 Foundation (RLS, JWT scaffold, theme, base components).
- Services: Supabase Auth, Supabase Postgres, Resend (password reset emails).
- Data: `tenants`, `profiles`, `tenant_members`, `subscriptions`, `audit_log`.

**Step-by-step build sequence:**
1. Wire Supabase Auth in the Next.js App Router (`/(auth)` segment, cookie-based session, middleware refresh).
2. Build `/signup` form: email + password + business name. Server Action wraps a Postgres transaction that creates `tenants`, owner `tenant_members`, `subscriptions` with `status=trial` + 14-day trial window, sets `profiles.active_tenant_id`, writes the first `audit_log` row.
3. Build `/signin` form. Server Action validates session and routes to `/app/today`.
4. Build `/forgot-password` and password-reset email via Resend.
5. Add `:focus-visible` rings and inline error states on the design tokens.

**Acceptance criteria:**
- [ ] Sign-up with a fresh email `pilot@calhounfoods-test.example` creates exactly one row each in `tenants`, `tenant_members` (role=`owner`), `subscriptions` (status=`trial`, trial_end = now + 14 days), `profiles` (active_tenant_id set), and `audit_log` (action=`tenant.created`). Verified by an integration test that rolls back the transaction if any one row fails to insert.
- [ ] JWT decoded from the cookie carries `tenant_id`, `role='owner'`, and `token_generation` claims; middleware rejects sessions where `token_generation` is behind the current `tenants.token_generation`.
- [ ] All form copy is real-feeling, no "Username", no "Submit". Sign-up CTA reads "Create my workshop." Sign-in CTA reads "Open the workshop."
- [ ] WCAG AA contrast on every input + label + error state. Tab order is linear; focus-visible visible at every stop.
- [ ] No hardcoded colors, fonts, or spacing.

**Codex review checklist:**
- [ ] Tenant + member + subscription creation atomicity (deliberate transaction-abort test produces zero orphan rows).
- [ ] Password handling: never logged, never returned in any API response, never written to `audit_log` `before`/`after` jsonb.
- [ ] CSRF protection inherited from Next.js Server Actions; cross-origin sign-up attempt rejected.
- [ ] `audit_log` row for sign-up exists with `actor_user_id` = new user id and `before` = `{}`, `after` = tenant + member columns minus secrets.
- [ ] **Memorable element visible in preview screenshot or Playwright interaction test.**

**What's memorable:** Sign-up is a single screen. Three inputs stacked vertically (business name, email, password) on the cool-light bench surface, each with a cobalt focus ring. The CTA reads "Create my workshop." On submit, the screen does NOT redirect — instead the bench fades in around the form, the rails slide in from left and right, and the onboarding chain begins forming horizontally where the form was. Total transition under 800ms. The signup screen becomes the workshop. (Required visible artifact: Playwright test that captures a screenshot at sign-up form → 400ms → bench-with-onboarding-chain transition.)

---

## Feature: Tenant onboarding workflow (dual-path)

**Why**: PRD §Flow 1 — Onboarding and data setup. Two paths: existing business (QBO connect + CSV history) vs greenfield (guided fresh start with minimum fields).

**Dependencies:**
- Other features: Account creation, Master data (products + suppliers), CSV import OR QBO integration (at least one).
- Services: Workflow DevKit (`onboardingWorkflow`), Supabase Postgres.
- Data: `onboarding_state`, `tenants`, `products`, `suppliers`, `inventory_levels`, `stock_movements`, `source_connections`.

**Step-by-step build sequence:**
1. After sign-up, route to `/app/onboarding`. Path-picker: "I have data in QuickBooks" / "I have a spreadsheet" / "I'm starting fresh."
2. Start `onboardingWorkflow(tenantId, path)`. `"use workflow"` orchestrator; calls step functions for OAuth, CSV parse, fresh-default writes.
3. QBO path: kick OAuth, wait for callback via `createHook`, then `qboInitialSyncWorkflow` as a child workflow. Render live progress UI consuming the workflow run's stream.
4. CSV path: file upload, parse + validate via `CsvSourceAdapter`, column mapping UI, dry-run preview, commit on user confirm.
5. Fresh path: guided forms for first product, first supplier, first location (default "Main"). Enforce minimum-field set per `onboarding_state.minimum_fields_met`.
6. On completion (all minimums met), kick `forecastTenantBatchWorkflow` for the first run. Show a "preparing your workshop" panel with shimmer skeletons.
7. Route to `/app/today` once first forecast lands; `onboarding_state.completed_at` set.

**Acceptance criteria:**
- [ ] Each path completes end-to-end with a real test account, asserted by integration tests with the fixture accounts `pilot-qbo@example.test`, `pilot-csv@example.test`, `pilot-fresh@example.test`.
- [ ] Workflow survives a deliberate `process.exit(0)` mid-CSV-parse; resumes from `sync_runs.cursor` on retry; ends with the same final state as a clean run.
- [ ] Minimum-field set enforced: products require SKU + name + unit_cost + UoM; suppliers require name + default_lead_time_days; product_supplier links require unit_cost + lead_time_days. Workflow cannot mark `completed_at` until met.
- [ ] First forecast batch starts within 30 seconds of `onboarding_state.first_forecast_ready_at` trigger.
- [ ] Onboarding cannot be skipped past minimums without explicit "seed-only" opt-in (a Server Action that audit-logs the bypass).

**Codex review checklist:**
- [ ] `onboardingWorkflow` orchestrator uses `"use workflow"`; all I/O steps use `"use step"`.
- [ ] Workflow run state surfaced via `getReadable()` streamed to the client, not polled from DB.
- [ ] Failed CSV rows go to `sync_failures` with actionable error codes; never silently dropped.
- [ ] No partial-state tenants left if onboarding aborts (transaction rollback on every commit step).
- [ ] **Memorable element visible in preview screenshot or Playwright interaction test.**

**What's memorable:** The onboarding panel IS a chain that forms in front of the user. Each step (path picked → source connected → catalog imported → suppliers imported → first forecast ready) is a typeset link block that ignites in cobalt as it completes. By the time the user reaches "today," they already understand The Chain's core visual metaphor. (Required visible artifact: Playwright test capturing the chain in three states: empty → 2-of-5-lit → 5-of-5-lit.)

---

## Feature: Master data — products + SKUs

**Why**: PRD §"Feature list" — Product / SKU catalog with current stock, unit cost, supplier, lead time. The canonical-model anchor.

**Dependencies:**
- Other features: Wave 1 Foundation, Account creation.
- Services: Supabase Postgres + RLS.
- Data: `products`, `product_classifications`, `inventory_levels`, `product_suppliers`.

**Step-by-step build sequence:**
1. Build `/app/inventory` (list view). Server Component reads `products` joined with `inventory_levels` + `product_classifications`. Table renders with `StatNumber` for numerics, hairline-divided rows.
2. Build `/app/inventory/[productId]` (detail view). Panels for: identity (SKU, name, attributes), current position (on-hand / allocated / in-transit per location, using `StatNumber`), supplier sources, ABC/XYZ classification, Days of Supply + Stockout Risk Score widgets.
3. Server Actions `createProduct`, `updateProduct`, `archiveProduct`. RLS enforces tenant + role; only planner/manager/owner can mutate.
4. Bulk operations: select rows + apply tag, archive, or supplier reassignment via a single Server Action.
5. Search + filter (by SKU substring, supplier, ABC class, stockout risk bucket).

**Acceptance criteria:**
- [ ] Inventory list `/app/inventory` returns p50 < 600ms and p95 < 1.2s for a seeded tenant of 5,000 active SKUs (warm cache, preview environment). Test harness: `npm run bench:inventory` with `SEED=5k`.
- [ ] Every consequential number rendered through `<StatNumber>` (Plex Mono tabular). Lint check: `<StatNumber>` import count vs. inline number-rendering count.
- [ ] Cross-tenant probe: logged in as Tenant A, attempt to GET `/app/inventory/[productId]` for Tenant B's product — must 404.
- [ ] Detail view shows the SKU's "policy chain" — a small visualization of forecast → recommendation → PO state — at the top of the page.
- [ ] No card boxes around the table; hairline dividers only.

**Codex review checklist:**
- [ ] N+1 query check on the list view (EXPLAIN ANALYZE plan inspection).
- [ ] Index usage: queries hit `inventory_levels(tenant_id, location_id)` and `(tenant_id, product_id)`, not full scans.
- [ ] Server Component vs Client Component boundary clean: only filters/search/bulk-select are client islands.
- [ ] Search escapes SQL wildcards correctly.
- [ ] **Memorable element visible in preview screenshot or Playwright interaction test.**

**What's memorable:** The SKU detail page renders the product's lifetime as a small chain visualization at the top — "first stocked → forecasted → reordered → received" with timestamps. Same chain motif scaled down. You read one SKU's story at a glance. (Required visible artifact: Playwright test capturing the SKU detail header chain.)

---

## Feature: Master data — suppliers + lead times

**Why**: PRD §"Feature list" — Supplier records with lead time, MOQ, cost; foundation for the reorder workflow and supplier scorecard.

**Dependencies:**
- Other features: Wave 1 Foundation, Account creation.
- Services: Supabase Postgres + RLS.
- Data: `suppliers`, `product_suppliers`, `supplier_performance`, `supplier_scorecards`.

**Step-by-step build sequence:**
1. Build `/app/suppliers` (list view) showing supplier name, products supplied count, default lead time, current OTIF % from `supplier_scorecards`.
2. Build `/app/suppliers/[supplierId]` (detail view): contact info, lead-time history (median + p90), product links, performance timeline.
3. Server Action CRUD (create / update / archive) with role gating.
4. Product-supplier link UI: from product detail or supplier detail, manage `product_suppliers` rows (primary + alternates) with per-link cost, lead time, MOQ.

**Acceptance criteria:**
- [ ] Supplier list shows OTIF % through `<StatNumber>` with semantic flow/warn/stop tag colors.
- [ ] Editing a default lead time triggers the next-run forecast batch to use the new value; downstream `inventory_policy` recompute observed in next batch run.
- [ ] Multi-source SKUs render all suppliers ranked by `is_primary` + reliability score.
- [ ] Archiving a supplier referenced in any open PO is rejected with a clear error message naming the open POs.

**Codex review checklist:**
- [ ] DB constraint or trigger enforces only one `is_primary=true` per `(tenant_id, product_id)` in `product_suppliers`.
- [ ] Cross-tenant RLS: logged-in as Tenant A, no select/insert/update on Tenant B's `suppliers` or `product_suppliers`.
- [ ] Role authorization: viewer cannot edit; warehouse cannot edit (per RLS matrix); planner/manager/owner can.
- [ ] Editing a supplier with open POs triggers downstream `inventory_policy` invalidation on next batch.
- [ ] **Memorable element visible in preview screenshot or Playwright interaction test.**

**What's memorable:** Each supplier card carries a mini reliability chain — a horizontal sequence of the last 8 POs as small link tiles, lit cobalt for on-time + in-full, amber for short, stop-red for very late. You scan a supplier and read their reputation in one glance. (Required visible artifact: Playwright test capturing the supplier-card mini-chain ribbon.)

---

## Feature: CSV import (`CsvSourceAdapter`)

**Why**: PRD §"Feature list" — Universal data ingestion fallback. PRD §57 requires QBO and CSV to share the same `SourceAdapter` interface. Required for dual-path onboarding and ongoing bulk updates.

**Dependencies:**
- Other features: Wave 1 Foundation (`SourceAdapter` interface + canonical payloads), Onboarding, Master data.
- Services: `papaparse`, Workflow DevKit, Supabase Postgres.
- Data: `products`, `suppliers`, `stock_movements`, `sync_runs`, `sync_failures`.

**Step-by-step build sequence:**
1. Implement `CsvSourceAdapter` conforming to `SourceAdapter` interface from Foundation. `source: 'csv'`. Capabilities: `readProducts: true`, `readSuppliers: true`, `readStockMovements: true`, `readPurchaseOrders: false`, `writePurchaseOrders: false`, `webhooks: false`.
2. `pull(kind, cursor, idempotencyKey)` accepts an in-memory CSV (passed via the upload session) and returns `PullResult<kind>` with canonical payloads. Cursor encodes the parse position for resumability across long files.
3. Build `/app/import` with three import kinds: products, suppliers, sales/movements. Drag-and-drop upload.
4. Column-mapping UI: visualize CSV columns vs canonical payload fields per kind. Required fields marked. Default-from-name heuristic. Cobalt connector line forms between matched columns as user drags.
5. Validation pass (inside `"use step"`): required fields present, types valid, no duplicate natural keys. Errors land in `sync_failures` with row numbers.
6. Dry-run preview: first 50 rows rendered against the canonical model. User confirms or cancels.
7. Commit step: `INSERT ... ON CONFLICT` bulk insert keyed on `(tenant_id, natural_key, idempotencyKey)`. Sales/movements normalize into `stock_movements` rows with `type` (sale/receipt/adjustment) and `occurred_at` preserved from the source.
8. Recurring import: provide a "re-upload this kind of CSV" flow for periodic spreadsheets.

**Acceptance criteria:**
- [ ] `CsvSourceAdapter` compiles against the `SourceAdapter` interface. Verified by a TypeScript test that imports both and asserts assignment.
- [ ] 10,000-row CSV imports in under 30 seconds end-to-end (p95, warm cache, preview environment). 50,000-row stress test (non-SLO) completes without OOM and reports progress via the workflow stream.
- [ ] Validation failures don't block valid rows; user can review failures and re-upload corrected rows.
- [ ] Re-upload is idempotent: re-uploading the same CSV with the same `idempotencyKey` doesn't duplicate stock movements or supplier records.
- [ ] Sales/movements ingestion: every row writes a `stock_movements` row with the correct `type`, signed `quantity`, `occurred_at` preserved from the CSV, and `source='csv'`. Forecasting can read from these rows on next batch.

**Codex review checklist:**
- [ ] `CsvSourceAdapter` covers every `EntityKind` it claims via capabilities; missing kinds throw `FatalError` cleanly.
- [ ] Encoding handling: UTF-8 + UTF-8 BOM + Latin-1; bad encoding fails with a clear error, doesn't corrupt data.
- [ ] Excel CSV variants (CR-only line endings, quoted commas with embedded newlines) parsed correctly.
- [ ] Memory budget: streaming parse where row count exceeds threshold; tested with 50K rows.
- [ ] Idempotency key honored at commit; deliberate re-commit test produces zero duplicates.
- [ ] **Memorable element visible in preview screenshot or Playwright interaction test.**

**What's memorable:** The column-mapping screen IS the canonical-model preview. CSV columns on the left, The Chain's canonical fields on the right with a live first-row preview already mapped. Mapping is a tactile drag from left to right; a cobalt connector line forms between matched fields like wiring connections on a workshop pegboard. (Required visible artifact: Playwright test captures the mapping screen with three cobalt connector lines drawn.)

---

## Feature: QuickBooks Online integration (`QboSourceAdapter`)

**Why**: PRD §"Feature list" + §Wave 1 — Native two-way ERP sync; reads items/vendors/POs/bills/sales; writes back generated POs. Wave 1 anchor integration.

**Dependencies:**
- Other features: Wave 1 Foundation (`SourceAdapter`), Master data.
- Services: Intuit QBO SDK + OAuth 2.0, Workflow DevKit, Supabase Postgres. **Token encryption-at-rest: app-side AES-256-GCM** (`QBO_TOKEN_ENC_KEY`), NOT `pgsodium` — pgsodium is deprecated on PG15+ Supabase (the init migration's `encrypted_credentials` note anticipated this). Decided + shipped 2026-06-05 Wave 6.2a.
- Data: `source_connections`, `sync_runs`, `sync_failures`, `sync_conflicts`, `products`, `suppliers`, `purchase_orders`, `stock_movements`.

**Step-by-step build sequence:**
1. Build `/app/integrations/quickbooks` panel. "Connect" CTA initiates OAuth via Server Action.
2. Build `/api/qbo/oauth/callback` route handler. Exchange code, encrypt tokens with app-side AES-256-GCM (stored in `source_connections.encrypted_credentials` bytea via the service-role base64 bridge RPCs), insert `source_connections` row with `status=active`, `capabilities` jsonb set.
3. Implement `QboSourceAdapter` conforming to `SourceAdapter`. `pull(kind, cursor, idempotencyKey)` paginates QBO API per kind. `push('purchase_order', payload, idempotencyKey)` writes back generated POs idempotently using The Chain's PO id as a metadata round-trip identifier.
4. `qboInitialSyncWorkflow(connectionId)` — full pull of items → vendors → POs → bills → sales. Cursor persisted in `sync_runs.cursor` between steps. Sales/bills normalize into `stock_movements` with `occurred_at` from QBO source dates.
5. `qboIncrementalSyncWorkflow(connectionId, since)` — delta sync, triggered by `vercel.ts` cron every 15 minutes AND by Intuit's auto-webhook via Workflow DevKit `createWebhook()` at `/.well-known/workflow/v1/webhook/:token`.
6. Conflict resolution: implement the split policy (server-wins for our POs; last-write-wins by `external_updated_at` vs `updated_at` for catalog/vendor edits; never overwrite receipts; `needs_review` for anything else). Write `sync_conflicts` rows on mismatch; surface in `/app/flow/sync-conflicts`. `resolveSyncConflict(conflictId, resolution, merge_payload?)` Server Action lets owner/manager pick.
7. Disconnect flow: revoke tokens, mark connection inactive, halt scheduled syncs.

**Acceptance criteria:**
- [ ] OAuth complete + first sync running within 60 seconds of clicking Connect (p95, against Intuit sandbox).
- [ ] Token refresh handled silently on use; expired refresh tokens surface an alert (`kind=sync_failure`).
- [ ] Incremental sync runs every 15 minutes by default; cron declared in `vercel.ts`.
- [ ] Generated PO writes back to QBO with The Chain's `tenant_id` + internal PO id as metadata fields; round-trip lookup finds the same record without duplicates.
- [ ] Disconnect leaves tenant data intact (no cascade delete on `products`, `suppliers`, etc.).
- [ ] Sales + bills ingestion: each writes a `stock_movements` row with correct `type`, signed `quantity`, `occurred_at` matching QBO source date, `source='qbo'`, `source_ref` = QBO entity id. Forecasting reads from these rows.

**Codex review checklist:**
- [ ] OAuth tokens never logged, never returned in any API response, never present in `audit_log` `before`/`after`. Encrypted at rest verified.
- [ ] Workflow boundary: `"use workflow"` orchestrator, `"use step"` for every QBO API call.
- [ ] Idempotency keys on every push call (`/api/exports/po/[poId].csv` reissue test produces zero duplicate POs in QBO sandbox).
- [ ] Rate limit handling: 429 throws `RetryableError` with `retryAfter` set from QBO's response header.
- [ ] **Conflict policy branch tests:** server-wins path (our PO + concurrent QBO edit → our state wins, conflict logged); last-write-wins path (concurrent catalog edit, newer external_updated_at → external wins, conflict logged); needs_review path (genuinely unresolvable conflict → row with `status='needs_review'` + `warn` alert); `resolveSyncConflict` accept_local / accept_remote / merge all paths exercised.
- [ ] Webhook signature verification on every Intuit webhook callback before any processing.
- [ ] **Memorable element visible in preview screenshot or Playwright interaction test.**

**What's memorable:** The connect screen shows a live cobalt chain forming as the durable initial sync runs — the **CATALOG** link forms as items arrive as products, **SUPPLIERS** as vendors arrive, **SALES** as bills + sales movements land. Each link ignites from REAL workflow phase progress (not a timer), and on completion the panel links straight into the freshly imported `/inventory` + `/suppliers`. You watch your QuickBooks data become a visible, navigable chain in real time. (POs are read-only-counted to inform the run, not yet written; write-back is Wave 6.3.) (Required visible artifact: Playwright test captures the connect screen at three states: pre-connect, mid-sync, post-sync, showing the chain growing.)

> **Contract note (2026-06-06, Wave 6.2b):** the chain was originally specced supplier → ordered → in-transit (for the 6.2a read-only preview). It was changed to CATALOG → SUPPLIERS → SALES so it reflects what the durable sync actually writes into the catalog. MG approved keeping the new sequence; may be revisited if it doesn't fit alongside the inventory-controls surfaces.

---

## Feature: ABC + XYZ classification

**Why**: PRD §"Feature list" — Auto-sorts SKUs by value (ABC) and demand variability (XYZ via ADI/CV²). Visible per SKU.

**Dependencies:**
- Other features: Master data products, Demand forecasting (for ADI/CV² inputs).
- Services: Workflow DevKit (classification step inside forecast batch).
- Data: `products`, `product_classifications`, `classification_thresholds`, `stock_movements`.

**Step-by-step build sequence:**
1. Implement classification step inside `forecastTenantBatchWorkflow`. For each SKU: compute trailing-365d revenue (or unit-cost basis per `classification_thresholds.revenue_basis`), assign ABC; compute ADI/CV² from `stock_movements`, assign XYZ.
2. Upsert `product_classifications` row per (tenant, product, location). Include `threshold_version_id` reference.
3. Build classification badge component (Plex Mono uppercase, 10px, semantic tints).
4. Surface ABC/XYZ on inventory list (filter/sort), product detail (badge row), forecast view (drives method routing — Croston/SBA/TSB for intermittent X-class).
5. Build `/app/inventory/classification` quadrant view (A-B-C × X-Y-Z grid, SKUs plotted as small typeset tiles, drag-zoom into a quadrant).

**Acceptance criteria:**
- [ ] Every active SKU has a current `product_classifications` row after the nightly batch.
- [ ] Threshold version changes (`classification_thresholds` row insert) trigger a reclassification run; previous classifications retained in `audit_log` for replay.
- [ ] Quadrant view `/app/inventory/classification` returns p95 < 1.5s for 5,000 SKUs (warm cache, preview env).
- [ ] Drag-zoom into a quadrant filters the SKU list below; URL search params capture the zoom state.

**Codex review checklist:**
- [ ] Cold-start handling: SKUs with insufficient history flagged as "unclassified" + `cold_start_state='cold'`, never assigned a misleading class.
- [ ] Revenue basis (cost vs price) is consistent within a single `threshold_version_id`.
- [ ] Mutation of `product_classifications` is system-only per RLS matrix (no user can manually re-classify a SKU via API).
- [ ] **Memorable element visible in preview screenshot or Playwright interaction test.**

**What's memorable:** The classification quadrant IS the page. SKUs render as tiny typeset tiles (SKU stub in Plex Mono) plotted in the A/B/C × X/Y/Z grid. A cobalt rectangle outlines "where the money is" (A/X high-value high-stable). Operators drag-zoom to focus a quadrant; the rest fades to inset pewter. (Required visible artifact: Playwright test captures the quadrant in full view, then zoomed into A/X.)

---

## Feature: Demand forecasting pipeline

**Why**: PRD §"Feature list" + §"Tech preferences" — Per-SKU statistical demand forecasts via Nixtla `statsforecast`. LLM is explanation only.

**Dependencies:**
- Other features: Master data products, ABC/XYZ classification (for method routing), Wave 1 Foundation (workflow runtime).
- Services: Vercel Fluid Python function, Workflow DevKit, Vercel Cron, Supabase Postgres.
- Data: `stock_movements` (input), `forecasts`, `forecast_points`, `forecast_evaluations`, `product_classifications`.

**Step-by-step build sequence:**
1. Build the Python function at `/api/forecast` (Vercel Fluid Python 3.13). Single entrypoint: accept (SKU, history, horizon, seasonality hint, method override), return forecast points + RMSSE/WAPE backtest + cold-start flag.
2. Implement method-routing logic per ADI/CV²: Croston/SBA/TSB for intermittent (X-class), AutoETS/AutoARIMA for smooth/erratic (Y/Z).
3. Build `forecastTenantBatchWorkflow(tenantId)` — fan out into `forecastShardWorkflow` per shard of 200 SKUs, concurrency capped by `tenants.forecast_concurrency_limit` (default 4), backpressure halves concurrency on `RetryableError`.
4. Each shard step: call Python function per SKU, write `forecasts` + `forecast_points` + `forecast_evaluations` + `inventory_policy` in a single transaction. Idempotent on `(tenant_id, product_id, run_id)`.
5. Run a seasonal-naive baseline against the same history; `forecast_evaluations.beats_baseline` set; only forecasts that beat baseline are `promoted=true`.
6. Schedule the batch nightly via `vercel.ts` cron. On-demand recompute via `recomputeForecast(productId, locationId)` Server Action.
7. Build `/app/forecasts/[productId]` view: chart of history + forecast + 80/95% confidence bands rendered via `<StatNumber>` for the tabular accompaniment.
8. **Forecast eligibility threshold (explicit):**
   - **cold** = fewer than 30 days of `stock_movements` of type `sale` for the SKU. UI label "warming up — using category benchmark." `eligibility_threshold_met = false`. `promoted = false`. Forecast points filled with category benchmark, never with a model prediction.
   - **warming** = 30-89 days. Forecast generated but `eligibility_threshold_met = false`. `promoted = false`. UI label "early signal — confidence limited."
   - **warm** = 90+ days. `eligibility_threshold_met = true`. `promoted = true` IFF `beats_baseline = true`.
9. **Category benchmark for cold-start:** computed from the trimmed mean of `warm` SKUs in the same `products.attributes.category`. Stored in a tenant-level `category_benchmarks` materialized view, refreshed in the forecast batch.

**Acceptance criteria:**
- [ ] Every `promoted=true` forecast beats seasonal-naive on rolling-origin backtest (RMSSE primary, WAPE operator-facing).
- [ ] MAPE is NEVER stored or surfaced (PRD ban). Lint check: grep for `MAPE` in source returns zero hits outside doc comments.
- [ ] Forecast batch for 5,000 SKUs completes p95 < 15 minutes end-to-end (preview env). 50,000 SKUs (non-SLO stress test) completes without OOM; sharding visible in `sync_runs.error_log`.
- [ ] Cold-start SKUs labeled "warming up" with category benchmark visible; never show a model prediction.
- [ ] Confidence bands rendered as 1px gray ranges, not filled cobalt bars (trust hierarchy enforced via `<StatNumber>` component).

**Codex review checklist:**
- [ ] Python function stateless: no global state, no DB writes inside Python.
- [ ] Backpressure: shard failures halve concurrency for the run; documented in `sync_runs.error_log` with timestamps.
- [ ] Workflow uses child workflows via `start()` from inside a `"use step"`, not direct call from `"use workflow"`.
- [ ] Eligibility threshold transitions (cold → warming → warm) audit-logged.
- [ ] **Memorable element visible in preview screenshot or Playwright interaction test.**

**What's memorable:** The forecast chart on the SKU detail page is the workshop's centerpiece. History renders as a Plex Mono tabular timeline; forecast renders as forward-projecting points with 80%/95% confidence bands shown as widening pewter rings. A small cobalt diamond marks "today." Below the chart, a tiny mono caption reads "Beats seasonal-naive by 14.3% RMSSE." You trust it because you can see the math. (Required visible artifact: Playwright test captures the forecast chart with the cobalt today-diamond and the RMSSE lift caption.)

---

## Feature: Inventory optimization (policy + DOS + stockout risk)

**Why**: PRD §"Feature list" — Reorder point, safety stock, recommended order quantity derived from forecast + lead time + service level. Days of Supply + Stockout Risk Score as named widgets.

**Dependencies:**
- Other features: Demand forecasting, Master data, Wave 1 Foundation.
- Services: Workflow DevKit (runs in forecast batch).
- Data: `inventory_policy`, `forecasts`, `product_suppliers`, `inventory_levels`, `supplier_scorecards`.

**Step-by-step build sequence:**
1. Add policy derivation step at the end of each forecast shard. For each (tenant, product, location): compute demand-during-lead-time from forecast, safety stock via `z × σ × √L` (use empirical σ from `supplier_scorecards.lead_time_stddev_days` if sample_size ≥ 5), reorder point, recommended order qty (EOQ with practical adjustments).
2. Compute Days of Supply: on-hand / mean daily demand. Compute Stockout Risk Score: probability the next reorder cycle ends below safety stock.
3. Upsert `inventory_policy` row. Audit-logged.
4. Build the Days of Supply widget (large `<StatNumber>`, flow/warn/stop tag, tiny context line "Forecast holds through {date}").
5. Build the Stockout Risk Score widget (`<StatNumber>`, semantic tag).
6. Build `/app/inventory/policy` view with what-if controls: service level slider (90% → 99%), lead time override, supplier swap. Each change recomputes the policy in real time via a Server Action that returns recomputed values without DB writes. "Save as default" commits to `inventory_policy`.

**Acceptance criteria:**
- [ ] Every SKU with a promoted forecast has a current `inventory_policy` row.
- [ ] What-if changes don't write to the DB until "Save as default" is clicked. Verified by integration test that scrubs the service level slider and asserts no DB write until the explicit save.
- [ ] Service level changes ripple to reorder point + safety stock + recommended order qty + stockout risk visibly within 250ms (p95).
- [ ] Lead-time variability fed into safety stock formula (z × σ × √L uses empirical σ from `supplier_scorecards.lead_time_stddev_days` when available).

**Codex review checklist:**
- [ ] What-if Server Actions don't accidentally persist state (audit_log row count test).
- [ ] Lead time used = `product_suppliers.lead_time_days` of primary supplier (or empirical from scorecard if sample_size ≥ 5); the policy detail view shows which source it pulled from.
- [ ] Service level slider min/max clamped (90%-99.5%).
- [ ] **Memorable element visible in preview screenshot or Playwright interaction test.**

**What's memorable:** The what-if panel has three slider levers (service level, lead time, supplier). Drag any one and the entire policy ribbon below it (DOS, ROP, safety stock, recommended qty, stockout risk) updates in real time as you scrub, each number ticking with a 200ms counter-roll. Operators feel the trade-offs. (Required visible artifact: Playwright test scrubs the service level slider from 95% to 99% and captures the policy ribbon at three intermediate points.)

---

## Feature: Supplier reliability scorecard

**Why**: PRD §"Feature list" + Codex Phase 1 sharpening — Promised vs actual lead-time tracking, OTIF computation, automatic safety-stock adjustment.

**Dependencies:**
- Other features: Master data suppliers, Reorder workflow.
- Services: Workflow DevKit (rollup), Supabase Postgres.
- Data: `purchase_orders`, `purchase_order_lines`, `supplier_performance`, `supplier_scorecards`, `product_suppliers`, `inventory_policy`.

**Step-by-step build sequence:**
1. Hook PO receipt: on `markPurchaseOrderReceived`, write a `supplier_performance` row capturing promised vs actual delivery date + quantity + on-time + in-full + OTIF flags.
2. Rollup step: after each receipt or on a daily cron, refresh `supplier_scorecards` per (tenant, supplier, window: rolling_30d / 90d / 365d / all_time). Store OTIF %, on-time %, in-full %, lead_time_avg + stddev, sample_size.
3. Feedback loop: when `supplier_scorecards.lead_time_stddev_days` diverges materially from `product_suppliers.lead_time_days`, the inventory policy recompute uses the empirical value.
4. Build the scorecard component (panel with OTIF % through `<StatNumber>`, on-time/in-full sub-stats, last 8 POs as a mini chain ribbon).
5. Embed scorecards on supplier list, supplier detail, the reorder recommendation review screen.

**Acceptance criteria:**
- [ ] Scorecard appears for any supplier with ≥1 received PO; rollup runs within 30s of receipt.
- [ ] Reliability metric is computed from `supplier_performance` row history, never from a user-input field. Verified by integration test that asserts the computation function only reads from `supplier_performance` (no UI input source).
- [ ] Inventory policy uses empirical lead time when `supplier_scorecards.sample_size ≥ 5`, configured `product_suppliers.lead_time_days` otherwise. Visible in policy detail view.
- [ ] Mini chain ribbon renders the last 8 POs colored by OTIF outcome.

**Codex review checklist:**
- [ ] Partial receipts handled: a PO received across two delivery dates correctly contributes two `supplier_performance` rows.
- [ ] Lead-time variability fed into safety stock formula correctly when sample_size threshold crossed.
- [ ] Cross-tenant RLS: scorecards for Tenant A's suppliers not visible to Tenant B.
- [ ] Role authorization on archive supplier with open POs (refused per Suppliers feature).
- [ ] Downstream policy invalidation: changing a supplier's empirical scorecard triggers `inventory_policy` recompute on next batch.
- [ ] **Memorable element visible in preview screenshot or Playwright interaction test.**

**What's memorable:** The scorecard panel header carries the supplier's mini chain ribbon — last 8 POs as a horizontal row of typeset link tiles, colored by OTIF outcome. Scan a supplier, read their reputation visually in one glance. (Required visible artifact: Playwright test captures the scorecard panel with the 8-PO ribbon.)

---

## Feature: Reorder workflow + PO lifecycle

**Why**: PRD §Flow 3 — Reorder recommendations + approval with full PO lifecycle (recommend → approve → export/mark-ordered → mark received → on-hand stock updates). The product's primary action loop.

**Dependencies:**
- Other features: Inventory optimization, QBO integration (for write-back), Suppliers + scorecards.
- Services: Workflow DevKit (`purchaseOrderLifecycleWorkflow`, `alertGenerationWorkflow`), Supabase Postgres.
- Data: `reorder_recommendations`, `purchase_orders`, `purchase_order_lines`, `inventory_levels`, `stock_movements`, `audit_log`.

**Step-by-step build sequence:**
1. Recommendation generation step inside `alertGenerationWorkflow` (post-forecast). For each SKU at/below reorder point, write a `reorder_recommendations` row with `status=open`, reason jsonb, version int.
2. Build `/app/reorder` queue view. Recommendations grouped by supplier. Each row shows SKU + recommended qty + reason + days of supply.
3. `convertRecommendationToPo(recommendationId | recommendationIds[], edits?)` Server Action — promotes one or many recommendations to a single PO (multi-line if same supplier).
4. Build `/app/reorder/po/[poId]` PO detail. Render the visible PO chain at top (the unforgettable thing at full size). Line items in tabular form via `<StatNumber>`. Supplier scorecard panel.
5. `approvePurchaseOrder(poId, idempotency_key)` Server Action triggers `purchaseOrderLifecycleWorkflow(poId)`: write back to QBO via step, advance PO `status` through stages, wait via `createHook` for `markPurchaseOrderReceived` with deterministic token = `po-${poId}-receipt`.
6. Receive flow: `/app/reorder/po/[poId]/receive` form for partial or full receipts. Writes `stock_movements` rows (`type=receipt`, signed quantity, `occurred_at=now()`) + updates `inventory_levels` + `supplier_performance`. Idempotent on `(po_id, line_no, receipt_n)`.
7. Export CSV at any state via `/api/exports/po/[poId].csv`.

**Acceptance criteria:**
- [ ] Recommendation → PO → approved → exported → received → on-hand update runs end-to-end for a real test account in under 2 minutes manual time.
- [ ] PO chain visualization renders all five state transitions accurately; active link ignite animation plays at state change.
- [ ] Partial receipt updates `inventory_levels.on_hand` and `in_transit` correctly; subsequent partial receipts compose without double-counting.
- [ ] All numbers rendered through `<StatNumber>`. No cobalt outside the four-intent budget on the PO detail page.
- [ ] **Long-running PO lifecycle:** an integration test simulates a PO approved but not received for 6 months. Workflow runtime preserves the run; hook token remains valid; the receive Server Action successfully resumes the workflow. If the workflow runtime has a max-age, the test verifies the policy and documents the recovery path.
- [ ] Trial-expiration during a pending PO: if the tenant's `subscriptions.status` flips to `past_due` mid-flight, the workflow continues to completion; new POs cannot be approved until subscription restored.

**Codex review checklist:**
- [ ] Idempotency on approve + receive: re-clicking doesn't double-write to QBO or double-increment on_hand.
- [ ] Workflow hook resumption: `markPurchaseOrderReceived` finds and resumes the correct lifecycle workflow via the deterministic token.
- [ ] PO lifecycle workflow survives `process.exit(0)` mid-flight; resumes on next workflow runtime within 30 seconds.
- [ ] Audit log on every state transition with `before`/`after` `status`, `total`, `expected_delivery_at`, `actual_delivery_at`.
- [ ] **Memorable element visible in preview screenshot or Playwright interaction test.**

**What's memorable:** The PO detail page IS the visible chain at full width. Links are large typeset blocks with timestamps. The active link is fully cobalt-filled with the ignite animation playing on state change. Receiving a PO triggers cobalt to flow into the "Received" link with a satisfying spring-physics fill. This is the product's hero moment. (Required visible artifact: Playwright test triggers `markPurchaseOrderReceived` and captures a 3-frame sequence of the cobalt flowing into the "Received" link.)

---

## Feature: AI insights layer (Claude)

**Why**: PRD §"Feature list" + §"Tech preferences" — Plain-English explanations of forecasts and recommendations. LLM never the forecaster, always the interpreter.

**Dependencies:**
- Other features: Demand forecasting, Inventory optimization, Reorder workflow.
- Services: Vercel AI Gateway + Claude, Workflow DevKit (steps wrap AI calls), Supabase Postgres.
- Data: `insights`, `forecasts`, `inventory_policy`, `purchase_orders`, `audit_log`.

**Step-by-step build sequence:**
1. Build prompt templates per insight kind: "Why this reorder," "Why this forecast," "What changed since last week." Versioned prompt strings stored in code.
2. Implement step wrappers around `generateText` for each insight kind. Steps return `{ content, confidence, model, prompt_version }`. Idempotent on `(tenant_id, entity_type, entity_id, prompt_version)`.
3. Insights generated lazily on first view of an entity; cached in `insights` table.
4. Build the `<ClaudeInsight>` panel component (right rail in app, follows trust hierarchy: Plex Mono "Claude · {topic}" prefix label in dim annotation, Plex Sans body, NEVER displays a number that isn't already in the statistical view).
5. Build a what-if entry point: user adjusts a slider (service level, lead time); Claude provides a "If you do this, here's what changes" interpretation alongside the recomputed `<StatNumber>` numbers.

**Acceptance criteria:**
- [ ] Every insight panel renders with the cited `model` + `prompt_version` visible in a small mono caption.
- [ ] Low-confidence (< 60%) and sparse-data SKUs surface explicit warnings ("Limited history — recommendation is more variable").
- [ ] Insights never appear as the source of a number; lint check asserts `<ClaudeInsight>` never wraps a `<StatNumber>`.

**Codex review checklist:**
- [ ] AI Gateway routing: model fallback works when Claude is unavailable.
- [ ] Prompts never include un-validated free text from user input (prompt injection guardrails).
- [ ] Cost monitoring: per-tenant insight call count surfaced in admin (counter wired Wave 1).
- [ ] `<ClaudeInsight>` component is the only path to Claude prose in the UI; lint check.
- [ ] **Memorable element visible in preview screenshot or Playwright interaction test.**

**What's memorable:** Claude's explanation reads like a colleague's whiteboard note. Two short sentences max, prefixed by a tiny Plex Mono "Claude · Why this reorder" label, with a hairline-divided "what changes if you bump service level to 99%" continuation. No emoji, no bullet points, no chatbot warmth — an operator's note from someone who knows the math. (Required visible artifact: Playwright test captures a `<ClaudeInsight>` panel on a PO detail page.)

---

## Feature: In-app alerts

**Why**: PRD §"Feature list" — Stockout risk, reorder-needed, overstock, late PO, sync failure, sync conflict, forecast low confidence. Dedupe + re-alert on severity rise.

**Dependencies:**
- Other features: Inventory optimization, Reorder workflow, QBO integration.
- Services: Workflow DevKit (`alertGenerationWorkflow`), Supabase Postgres.
- Data: `alerts`, `notification_preferences`, `inventory_policy`, `purchase_orders`, `sync_failures`, `sync_conflicts`.

**Step-by-step build sequence:**
1. Implement `alertGenerationWorkflow(tenantId)` — runs after forecast batch and after each sync. Walks fireable conditions.
2. Dedupe rules per SYSTEM_DESIGN.md §Alert generation contract: compute `dedupe_key = '{kind}:{entity_type}:{entity_id}'`; existing open + higher severity → insert new alert with `reopen_count++` and leave prior open; existing open + same/lower severity → update `updated_at` only; no existing open → insert new; condition clears → `auto_closed`.
3. Build `/app/flow/alerts` queue view. Tabular row per alert with kind icon, severity tag, entity link, age, ack/dismiss actions.
4. Build the alert tray (slide-in from the right rail) for in-context viewing.
5. Server Actions: `acknowledgeAlert(alertId)`, `dismissAlert(alertId, reason)`. Audit-logged.
6. Email channel as fast-follow (`notification_preferences.channel='email'`); Resend wired but disabled by default in Wave 1.

**Acceptance criteria:**
- [ ] Same condition firing repeatedly does NOT spam alerts. Verified by integration test that runs `alertGenerationWorkflow` three times for the same stockout-risk condition and asserts exactly 1 open `alerts` row exists.
- [ ] Severity rise (`info` → `warn` → `critical`) triggers a new alert row; severity drop or hold does not.
- [ ] Auto-close fires within 60s of condition clearing.
- [ ] Alert tray loads p95 < 300ms (warm cache, preview env, 100 open alerts).

**Codex review checklist:**
- [ ] Idempotency in alert generation: re-running the workflow for the same data doesn't create duplicate alerts. Unique partial index on `(tenant_id, dedupe_key) where status='open'` enforced.
- [ ] Dedupe key construction is unambiguous and stable across runs.
- [ ] Severity-rise re-fire: integration test asserts new row inserted with `reopen_count = prev + 1`.
- [ ] Auto-close: integration test asserts `status='auto_closed'` when condition clears.
- [ ] Notification side-effect (email) idempotency: re-running the workflow doesn't re-send the email for the same `(alert_id, channel)`.
- [ ] **Memorable element visible in preview screenshot or Playwright interaction test.**

**What's memorable:** Alerts have actionable specificity. Not "Stockout risk on SKU 47331." Instead: "SKU 47331 will hit stockout in 8.3 days at current run rate. Calhoun lead time is 7 days. Reorder 47 cases by Wed to hold service level." Each alert IS its own one-sentence operator memo with the cobalt CTA directly linked to the action. (Required visible artifact: Playwright test captures an alert row showing the full memo + the cobalt CTA.)

---

## Feature: Audit log + retention tiers

**Why**: PRD §"Feature list" + MG decision 2026-05-30 — Append-only audit from Day 1; tier-gated visibility; cold archive for storage cost discipline. Powers Wave 6 ROI dashboard.

**Dependencies:**
- Other features: Wave 1 Foundation (triggers + partitions exist), every mutation feature.
- Services: Workflow DevKit (`coldArchiveWorkflow`), Vercel Blob, Supabase Postgres.
- Data: `audit_log` (partitioned), `stock_movements` (partitioned), `subscriptions.retention_tier`, `cold_archives` (new).

**Step-by-step build sequence:**
1. Verify Foundation built partitioned tables + triggers + per-entity required-fields capture (already in Foundation acceptance).
2. Build `/app/flow/audit-log` view (owner / manager / finance only per RLS matrix). Tabular, hairline rows, mono timestamps via `<StatNumber>`, before/after diff renderer (collapsed jsonb, expand-on-click).
3. Implement `coldArchiveWorkflow` — daily cron. Detaches partitions older than global retention floor (10 years), uploads to Vercel Blob, records in `cold_archives` (id, tenant_id, partition_name, blob_url, archived_at).
4. Tier-gated visibility: `/app/flow/audit-log` filters by `subscriptions.retention_tier` hot window mapping (free/trial = trial period, starter = 1 year, standard = 5 years, pro = 10 years, enterprise/comp = unlimited). Older queries return a "Upgrade tier to unlock" stub with upgrade CTA.
5. Restore from cold: operator-driven Server Action `restoreColdPartition(tenantId, partitionName)` re-attaches a partition for a tenant who upgrades.

**Acceptance criteria:**
- [ ] Audit query within the tier hot window returns p95 < 500ms for a tenant with 12 months of history.
- [ ] Cold archive partition is bit-identical to the in-DB version (round-trip restore test: detach → upload to Blob → delete partition → restore from Blob → diff against pre-detach snapshot).
- [ ] Tier-gated visibility: setting `subscriptions.retention_tier` from `starter` to `pro` immediately exposes the wider window without partition movement.
- [ ] Required ROI fields present on every `audit_log` row per Foundation §Step 6: `inventory_levels` deltas include `on_hand`, `allocated`, `in_transit`, `location_id`; `purchase_orders` deltas include `status`, `total`, `expected_delivery_at`, `actual_delivery_at`, `supplier_id`; `stock_movements` includes `type`, `quantity`, `product_id`, `location_id`, `occurred_at`. Verified by a test that mutates each tracked table and asserts the required fields exist in the audit row.

**Codex review checklist:**
- [ ] RLS on `audit_log` differentiates `owner`/`manager`/`finance` from `planner`/`warehouse`/`viewer` per matrix.
- [ ] No PII leaks into `audit_log` payloads beyond what the source row contains; password fields never appear.
- [ ] **Role abuse test: viewer attempts to GET `/api/exports/audit/[period].csv` → returns 403.** Planner attempts the same → 403. Finance attempts → returns the CSV for the tier hot window.
- [ ] Restore from cold partition is idempotent (re-running the workflow for an already-restored partition is a no-op).
- [ ] **Memorable element visible in preview screenshot or Playwright interaction test.**

**What's memorable:** The audit log view renders entries as a continuous vertical "chain of events." Each entry is a small typeset link block (timestamp + actor + action + entity), connected to the next by a 1px hairline. Same chain metaphor, vertical orientation. The "today" position is marked with a deep-slate dot. (Required visible artifact: Playwright test captures the vertical audit chain with the today dot.)

---

## Feature: Inventory health dashboard

**Why**: PRD §"Feature list" + §Flow 2 — The daily landing surface.

**Dependencies:**
- Other features: ALL of the above.
- Services: All reads via Supabase RLS.
- Data: Everything.

**Step-by-step build sequence:**
1. Build `/app/today` as the post-login landing route.
2. Top section: "today's chain" — the most pressing PO in flight rendered as the full visible chain. If no in-flight PO, show "no active chain — your workshop is at rest" with the dotted lattice background.
3. Metric strip below: SKUs at stockout risk (count via `<StatNumber>`), days of supply for the worst SKU, supplier OTIF for the most-used supplier. Each clickable.
4. Right rail: `<ClaudeInsight>` panel ("today's top recommendation") + recent alerts.
5. Bottom: throughput hairline with day ticks, today marker, last 7 days of PO completions as small typeset chips along the ruler.
6. Empty states for fresh tenants: "your bench is empty" copy + CTA to onboarding next step.

**Acceptance criteria:**
- [ ] Dashboard `/app/today` returns p50 < 800ms and p95 < 1.5s for a seeded tenant of 5,000 SKUs (warm cache, preview env). Test harness: `npm run bench:dashboard`.
- [ ] Renders meaningfully for tenants at every stage: empty (fresh), onboarding-in-progress, fully populated.
- [ ] Chain visualizer is the visual centerpiece.
- [ ] All numbers via `<StatNumber>`; no card boxes.
- [ ] **Wave 1 single-location single-user UI suppression:** no location selector visible; no role switcher visible; no multi-tenant selector visible (even if `profiles.active_tenant_id` allows it, Wave 1 UI does not expose tenant switching). Verified by an integration test that asserts the absence of these affordances.

**Codex review checklist:**
- [ ] Streaming Server Components + Suspense boundaries keep TTFB low.
- [ ] `'use cache'` directives tagged precisely on `tenant_id` + entity kind; mutations invalidate accurately.
- [ ] No multi-location / multi-user / multi-tenant UI affordances leak into Wave 1.
- [ ] **Memorable element visible in preview screenshot or Playwright interaction test.**

**What's memorable:** This IS the workshop. **One required interaction:** the chain's active link pulses (subtle 2s cobalt opacity wave) until the user acknowledges today's recommendation, at which point the pulse stops and a small flow-green dot replaces it. The dashboard's "active state" is literally signaled by a heartbeat on the chain. (Required visible artifact: Playwright test captures the dashboard in pulse-on state, then post-acknowledge in pulse-off state.)

---

## Feature: Subscription, trial, billing wiring

**Why**: PRD §"Feature list" + MG decision 2026-05-30 — Self-serve sign-up with 14-day trial default. Marketing-site + subscription-billing required for Wave 1 launch. PRD-implied Wave 1 scope confirmed by MG 2026-05-30.

**Dependencies:**
- Other features: Account creation (creates trial), Audit log.
- Services: Stripe (wired, not activated at Wave 1 ship), Workflow DevKit (trial countdown + state transitions).
- Data: `subscriptions`, `audit_log`.

**Step-by-step build sequence:**
1. Sign-up creates `subscriptions` row with `status=trial`, `trial_start=now()`, `trial_end=now()+14 days`, `retention_tier='free'`.
2. Trial countdown component (`<StatNumber>` digit) in the left rail, only visible while `status='trial'`.
3. Server Action `extendTrial` (admin only, audit-logged) for design partners and pilot customers.
4. Server Action `setRetentionTier` (admin only initially; surfaces in user UI when billing activates) — immediately changes audit-log + stock-movements visibility window.
5. `/app/settings/billing` placeholder showing current status + comp-flag + tier + trial end. Card collection UI wired but disabled until pricing locks.
6. Wire Stripe webhook receiver via `createWebhook`. When activated: `customer.subscription.created/updated/deleted` events update `subscriptions`.

**Acceptance criteria:**
- [ ] Trial countdown displays accurate days remaining (computed from `trial_end - now()`).
- [ ] Trial expiration: when `now() > trial_end`, status transitions to `past_due` via a daily cron step; app surfaces transition to read-only mode (forecasts viewable, no new POs, no settings changes); banner replaced with "Trial expired — upgrade to continue."
- [ ] Retention tier change updates audit-log visibility within seconds (cache-tag invalidation on `subscriptions:tenantId`).
- [ ] Comp accounts behave identically to active for app access; reflected only in admin UI.

**Codex review checklist:**
- [ ] Trial expiration handling: data preserved, app surfaces gated, clear upgrade CTA. Verified by integration test that fast-forwards clock past `trial_end`.
- [ ] Stripe wiring (deferred activation): when activated, idempotency on webhook handling (Stripe retries handled).
- [ ] **Role abuse test: planner attempts to call `setRetentionTier` Server Action → returns AUTHORIZATION_DENIED.** Viewer attempts → same. Owner attempts → succeeds. Finance attempts → succeeds for tier read, denied for tier write per RLS matrix interpretation (subscriptions are system-mutate only; need a deliberate admin path).
- [ ] **Memorable element visible in preview screenshot or Playwright interaction test.**

**What's memorable:** The trial countdown is a single Plex Mono "DAYS" + big number `<StatNumber>` in the lower-left rail. No banner, no panic, no "your trial expires soon!" toast. A quiet operator counter, same restraint as everything else in the bench. (Required visible artifact: Playwright test captures the rail countdown at day 14 and at day 2.)

---

## Feature: Marketing site

**Why**: PRD §"Audience" + Wave 1 GTM — Public-facing surfaces (hero, how-it-works, pricing, sign-in routing, footer). Distinct surface convention from the product app. PRD-implied Wave 1 scope confirmed by MG 2026-05-30.

**Dependencies:**
- Other features: Account creation (sign-in routes), Wave 1 Foundation (tokens).
- Services: PostHog (analytics), Resend (contact form, deferred), Vercel.
- Data: PostHog events (anonymous funnel metrics).

**Step-by-step build sequence:**
1. Build `/(marketing)` route segment with NO rails, NO bench layout — standard editorial flow against the same design tokens.
2. Build `/` (hero) page. Headline using Mona Sans wdth 75 weight 800. Chain hero with the notched-connector + ignite animation. CTA "Start 14-day trial." Asymmetric layout, not centered.
3. Build `/how-it-works` page. Sequential scroll with sticky-stacked sections — Connect → Forecast → Reorder → Receive. Each section uses the chain motif at smaller scale.
4. Build `/pricing` page. Tier table using hairline rules and tabular Plex Mono prices via `<StatNumber>`. No card boxes around tiers. Compare-table for retention windows.
5. Build `/about` and `/contact` (small, on-direction).
6. Build `/(marketing)/_layout.tsx` — same nav + footer as the product, NO bench.
7. Wire PostHog page-view tracking and "Start trial" conversion event.

**Acceptance criteria:**
- [ ] Marketing pages share design tokens with the product app (token-source-of-truth lint check on every CSS variable used).
- [ ] Marketing pages do NOT inherit the bench layout. Verified by integration test that asserts no left-rail, no right-rail, no bench-after pseudo on any `/(marketing)` page.
- [ ] Lighthouse Performance ≥ 90 on the hero (preview deployment, mobile + desktop).
- [ ] Hero chain animation runs on first paint; respects `prefers-reduced-motion`.
- [ ] Scroll progress hairline at top across long pages.

**Codex review checklist:**
- [ ] Route segment separation: `(marketing)` and `(app)` cannot accidentally share layout chrome (CI test asserts).
- [ ] SEO: meta tags, OG image, structured data.
- [ ] Accessibility: focus-visible, semantic headings, alt text.
- [ ] **Memorable element visible in preview screenshot or Playwright interaction test.**

**What's memorable:** The hero chain animation IS the marketing hook. Page loads, the chain forms left-to-right with the ignite animation reaching the "in transit" link — exactly what visitors see on the product dashboard later. The animation is the demo. No screenshots needed. (Required visible artifact: Playwright test loads `/` and captures the hero chain at 200ms, 1000ms, and final state.)

---

## How to add a feature mid-project
1. Add a new `## Feature:` block above (matching the template structure including the "What's memorable" line + the Phase 6 visible-craft gate in the Codex review checklist).
2. Update `MASTER_PROMPT.md` if the new feature requires new project-wide rules.
3. MG checkpoint on the addition only.
4. Codex review on the addition only (re-enter Phase 4 for that feature).
5. Build the feature in Phase 6 against its block.
