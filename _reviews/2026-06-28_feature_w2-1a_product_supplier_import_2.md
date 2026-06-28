# Codex Review — feature_w2-1a_product_supplier_import
**Date:** 2026-06-28 13:36
**Project:** The Chain
**Project type:** MoreTech Product
**Phase:** 6 (Features)
**Unit reviewed:** feature_w2-1a_product_supplier_import
**Review weight:** full
**Skills audited:** (none)
**Reviewer:** Codex CLI (model: gpt-5.4)

---

## What was done

- The fourth lane is real on the main import surface. [src/app/(app)/import/page.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/import/page.tsx:15) now includes `product_supplier`, and [src/lib/import/field-specs.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/import/field-specs.ts:150) defines the `"Supplier pricing"` spec with SKU, supplier, cost, lead time, MOQ, and supplier SKU.
- The write path exists. [src/lib/import/commit.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/import/commit.ts:292) resolves SKU and supplier references, emits `unknown_sku` / `unknown_supplier`, and calls the new RPC. [supabase/migrations/20260628140000_w2_1a_import_product_supplier_links.sql](/Users/themoreapp/More%20Technologies/projects/the-chain/supabase/migrations/20260628140000_w2_1a_import_product_supplier_links.sql:23) adds `import_product_supplier_links(jsonb)` with PK upsert and cheapest-link auto-primary when none exists.
- The lane is wired into the UI and basic tests. [src/app/(app)/import/actions.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/%28app%29/import/actions.ts:31) gates it to `owner|manager|planner`, and [tests/import/lanes.memorable.test.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/tests/import/lanes.memorable.test.tsx:33) plus [tests/import/commit-writers.test.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/tests/import/commit-writers.test.ts:201) cover lane rendering and the basic import path.

## What wasn't done

- The lane was not wired into inline onboarding, so the repo’s CSV onboarding path still exposes only three kinds. [src/app/(app)/onboarding/page.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/%28app%29/onboarding/page.tsx:62) still builds `importSpecs` from `product`, `supplier`, and `stock_movement` only. That means the accepted onboarding contract for product-supplier links remains undeliverable where the app actually walks a new tenant through CSV setup. [FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:138)
- Durable import support for this kind was not delivered. The action explicitly forces `product_supplier` off the durable path in [src/app/(app)/import/actions.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/%28app%29/import/actions.ts:91), and the durable writer hard-throws if it ever receives the kind in [src/lib/import/durable-commit.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/import/durable-commit.ts:149). That is a conscious deferral, not a shipped full CSV-lane implementation.
- The evidence file claims a scratchpad verification artifact, but there is no such file on disk. [_reviews/2026-06-28_feature_w2-1a_product_supplier_import.md](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-28_feature_w2-1a_product_supplier_import.md:53) cites `verify_link_rpc.sql`; repo search turns up nothing. That verification is undocumented lore, not a reviewable artifact.

## What can be done better

- The schema and field spec are too loose for a lane whose whole point is cost/lead/MOQ. [src/lib/source-adapter/canonical.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/source-adapter/canonical.ts:42) makes `unitCost` and `leadTimeDays` optional, and [src/lib/import/field-specs.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/import/field-specs.ts:171) marks them non-required in the CSV mapper. That invites rows that create links but still leave the downstream policy inputs blank.
- The verification set is narrow. [tests/import/writers-transform.test.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/tests/import/writers-transform.test.ts:88) proves “same SKU, different suppliers” survives, and [tests/import/commit-writers.test.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/tests/import/commit-writers.test.ts:214) proves unknown-ref handling, but nothing covers duplicate same-pair rows, whitespace-normalized supplier names, or any large-file boundary behavior.
- The import page comment is already stale. [src/app/(app)/import/page.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/%28app%29/import/page.tsx:10) still says “three importable specs” and “Products, suppliers, and sales/movements,” which is sloppy in the exact slice that added a fourth lane.

## What was missed

- Duplicate `(SKU, supplier)` rows in one CSV can take down the whole import. [src/lib/import/transform.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/import/transform.ts:216) disables dedup for `product_supplier` because `rowUnique:false`, [src/lib/import/commit.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/import/commit.ts:367) forwards every resolved pair, and the RPC does a single `insert ... on conflict (tenant_id, product_id, supplier_id) do update` in [supabase/migrations/20260628140000_w2_1a_import_product_supplier_links.sql](/Users/themoreapp/More%20Technologies/projects/the-chain/supabase/migrations/20260628140000_w2_1a_import_product_supplier_links.sql:43). Inference from those artifacts: two rows for the same product-supplier pair in one batch can hit Postgres’s “cannot affect row a second time” failure mode instead of becoming a row-level `duplicate_key` error.
- The onboarding minimum-field requirement is still not enforceable for this entity. [FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:138) says product-supplier links require `unit_cost + lead_time_days`, but the canonical schema leaves both optional in [src/lib/source-adapter/canonical.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/source-adapter/canonical.ts:46), the mapper leaves both optional in [src/lib/import/field-specs.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/import/field-specs.ts:171), and onboarding does not surface the lane at all in [src/app/(app)/onboarding/page.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/%28app%29/onboarding/page.tsx:62). That requirement is still paper-only.

---

## Decisions (dispositions mine, per the wave round-1 cadence — 2026-06-28)

**Fixed in-slice:**
- **Duplicate-pair crash (What was missed #1).** Real bug. The RPC now collapses duplicate
  `(product, supplier)` rows in one batch to the last occurrence (`with ordinality` + `distinct on`)
  before the upsert, so a single `INSERT ... ON CONFLICT` never touches a row twice. Re-verified
  against the live DB with a duplicate pair (Atlas 4.50 then 4.99 → one link at 4.99, no crash).
- **Loose cost/lead (What can be better #1 + What was missed #2).** `unitCost` + `leadTimeDays` are
  now `required` on the lane, matching the FEATURES Block 2 minimum-field contract.
- **Onboarding lane (What wasn't done #1).** The links lane is now in the inline onboarding CSV
  `importSpecs`, so the lane exists everywhere the app imports.
- **Phantom verification artifact (What wasn't done #3).** The RPC verification is committed as
  `_reviews/2026-06-28_w2-1a_verify_link_rpc.sql` (re-runnable), not a scratchpad path.
- **Stale page comment + narrow verification (What can be better #2, #3).** Import page header
  updated to four lanes; the verification artifact now covers the duplicate-pair case.

**Accepted / deferred (documented, not silent):**
- **Durable link writer (What wasn't done #2).** Conscious deferral — sync-only is correct for
  small link files. Ticketed in `_reviews/_tickets.md` (Wave 2).
- **Internal-whitespace supplier-name match (What can be better #2).** Out of scope: names are
  trimmed + matched on lower(name); internal-whitespace normalization is a future nicety.

Gates after fixes: tsc, biome, `check:craft`, runnable import tests, `next build` — all green. RPC
re-verified live (auto-primary + preserve-existing + in-batch dedup).
