-- ============================================================
-- The Chain - W2-3 UoM snapshot pair constraint
-- ============================================================
-- A conversion factor without a named purchase unit is ambiguous. Snapshot
-- fields are therefore paired: both present for a converted purchase unit, or
-- both absent when purchase unit equals stock unit.

alter table public.rfq_vendor_quotes add constraint rfq_vendor_quotes_uom_factor_pair_check
  check (
    (nullif(btrim(coalesce(quoted_purchase_uom, '')), '') is null)
    = (purchase_to_stock_factor is null)
  );

alter table public.requisition_lines add constraint requisition_lines_uom_factor_pair_check
  check (
    (nullif(btrim(coalesce(purchase_uom, '')), '') is null)
    = (purchase_to_stock_factor is null)
  );

alter table public.purchase_order_lines add constraint purchase_order_lines_uom_factor_pair_check
  check (
    (nullif(btrim(coalesce(purchase_uom, '')), '') is null)
    = (purchase_to_stock_factor is null)
  );
