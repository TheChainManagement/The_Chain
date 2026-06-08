-- Block 6 Wave 6.3-A — QBO purchase-order import.
--
-- Wave 6.2b writes products, suppliers, and movements into the catalog but only
-- COUNTS purchase orders. This wave imports them into `purchase_orders` +
-- `purchase_order_lines` during the durable initial sync, keyed on the QBO PO id
-- in `external_po_id` so a re-sync converges instead of duplicating.
--
-- The upsert needs a unique key over (tenant_id, external_po_id). A FULL unique
-- index (not partial) is correct here: Postgres treats NULLs as distinct in a
-- unique index, so this enforces one row per QBO PO while leaving unlimited
-- null-external rows per tenant for the system-generated POs the reorder engine
-- (Blocks 7-9) will create. supabase-js can infer it from
-- `onConflict: 'tenant_id,external_po_id'` directly (a partial index could not).

create unique index purchase_orders_tenant_external
  on purchase_orders (tenant_id, external_po_id);

-- The operator-meaningful PO number (QBO DocNumber, e.g. "PO-1001"). `external_po_id`
-- holds the QBO entity Id ("301") used for idempotency; this holds the human label
-- shown on the cockpit. Null for system POs (they carry their own internal id).
alter table purchase_orders add column external_reference text;
