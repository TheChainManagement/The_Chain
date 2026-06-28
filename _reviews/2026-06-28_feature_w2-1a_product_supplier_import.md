# W2-1a — Product↔supplier link import lane (evidence)

Date: 2026-06-28. Wave 2, data-model cleanup (W2-1), first sub-feature.
Scope: `docs/WAVE2_SCOPE.md` W2-1 ("product-to-supplier link import lane").

## Why

The Wave-1 operator eval needed a hand-written SQL seed to load product↔supplier terms
(cost / lead time / MOQ) because no import covered `product_suppliers`. This closes that gap: a
fourth CSV import lane ("Supplier pricing") loads a full catalog's terms from a spreadsheet.

## What shipped

- **Migration** `20260628140000_w2_1a_import_product_supplier_links.sql` — a SECURITY-INVOKER RPC
  `import_product_supplier_links(p_rows jsonb)`. Idempotent upsert on the `(tenant, product,
  supplier)` PK; **auto-primary**: any product with no primary supplier gets its cheapest link
  promoted (lowest unit_cost, then supplier_id) so the policy/reorder engine has a cost basis
  without a manual "set primary" pass. Only promotes where none exists → the one-primary partial
  unique index is never violated.
- **Field-spec + lane** (`field-specs.ts`): `PRODUCT_SUPPLIER_FIELDS` (SKU + supplier + cost + lead
  time + MOQ + supplier SKU) and a `product_supplier` KindSpec ("Supplier pricing"). SKU is the
  natural key with `rowUnique:false` (it recurs per supplier link); the PK upsert is the idempotency.
- **Writer** (`commit.ts` `writeProductSupplierLinks`): resolves SKU→product_id (case-sensitive) and
  supplier name→supplier_id (case-insensitive via lower(name)); unresolved rows become per-row
  `unknown_sku` / `unknown_supplier` failures (never fatal); resolved rows go to the RPC.
- **Wiring**: CSV adapter advertises `readProductSuppliers` + accepts the kind; the import page shows
  the lane (products → suppliers → **supplier pricing** → sales/movements); the action gates the
  kind (owner|manager|planner) and routes it through the **sync path only** (see scope note).
- The canonical `productSupplierAttributes` schema + `product_supplier` EntityKind already existed
  (Foundation wired-for-vision) — no canonical changes needed.

## Scope notes (honest)

- **Sync-only by design.** Link files are small (one row per pair; the eval's 100 products = ~99
  links). The durable import path doesn't cover this kind yet, so the action routes `product_supplier`
  to the synchronous commit regardless of size, and the durable dispatch throws defensively if it
  ever receives the kind. A durable link writer is a follow-up if large catalogs ever need it.
- **No is_primary CSV column.** Primary is decided by the auto-promote rule (cheapest when none) +
  the existing in-app SupplierLinks UI, not the spreadsheet — avoids the one-primary invariant
  conflict and keeps the lane focused on bulk-loading terms.

## Verification

- **RPC logic verified against the LIVE local DB** (the riskiest novel piece). Seeded a tenant with
  2 products + 2 suppliers (one product pre-set with a primary), simulated the JWT tenant context,
  and ran the RPC twice:
  - Product with no prior primary → its **cheaper** supplier auto-promoted to primary (Borden 4.10
    over Atlas 4.50). ✓
  - Product with an existing primary → **unchanged** (import added a supplier but did not steal the
    primary). ✓
  - Both products end with exactly one primary; `reimport` count steady, link counts steady =
    idempotent. ✓
  (Committed, re-runnable: `_reviews/2026-06-28_w2-1a_verify_link_rpc.sql`, run in a rolled-back
  transaction. It also covers in-batch dedup of duplicate pairs — see round-1 below.)
- **Pure transform tests** (`writers-transform.test.ts`, runnable): column auto-wire + cost/lead/MOQ
  coercion; the recurring SKU is NOT deduped (one product, many supplier links); missing supplier +
  non-integer MOQ flagged. 
- **Memorable lanes test** (`lanes.memorable.test.tsx`, runnable): now asserts the **four** lanes and
  exercises selecting the new "Supplier pricing" lane.
- **Integration test added** (`commit-writers.test.ts`, `runCsvImport — product-supplier links`):
  full authenticated path incl. auto-primary + unknown-ref failures. **Could not run locally** — the
  local Supabase GoTrue admin auth is environmentally broken this session (same issue proven on clean
  main in W2-0; `admin.auth.admin.createUser` → AuthRetryableFetchError). It runs in CI. The direct
  RPC DB verification above + the pure/UI tests are the locally-verified evidence.
- Gates: `tsc`, `biome`, `check:craft`, `next build` — all green. Runnable test suites pass.

## Codex round-1 (gate) — applied before push

`moretech-codex-review` (gpt-5.4, full); review + dispositions in
`_reviews/2026-06-28_feature_w2-1a_product_supplier_import_2.md`. Fixed in-slice:
- **Critical bug:** duplicate `(SKU, supplier)` rows in one file would hit Postgres "cannot affect
  row a second time" and fail the whole import. The RPC now dedups in-batch (last wins via
  `with ordinality` + `distinct on`). Verified with a duplicate-pair case (Atlas at 4.50 then 4.99 →
  one link at 4.99, no crash, cheapest-primary still correct).
- **FEATURES contract:** `unitCost` + `leadTimeDays` are now required on the lane (FEATURES Block 2
  minimum-field set; the engine needs both).
- **Onboarding:** the links lane is now wired into the inline onboarding CSV path (was 3 lanes).
- **Reviewable artifact:** the RPC verification is committed (`_reviews/..._verify_link_rpc.sql`),
  not a phantom scratchpad path.
- **Stale comment:** import page header now says four lanes.

Deferred (ticketed in `_reviews/_tickets.md`): durable link writer (sync-only is a conscious
deferral; link files are small). Accepted: internal-whitespace supplier-name normalization is out of
scope (names are trimmed + lowered).

## Next

Push + hosted migration. Then W2-1b (UoM dropdown).
