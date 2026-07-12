-- ============================================================
-- The Chain — W2-3a2: direct rfq FK on rfq_vendor_quotes
-- ============================================================
-- W2-3a linked quotes to their line (rfq_id, line_no) and vendor plate
-- (rfq_id, supplier_id) via composite FKs, but never to rfqs DIRECTLY — so
-- PostgREST's schema cache sees no rfqs ↔ rfq_vendor_quotes relationship and
-- the detail read cannot embed quotes (caught live, slice 3). A quote belongs
-- to its RFQ; make that explicit. Cascade matches the line/vendor FKs (delete
-- an RFQ, its quotes go with it) and the composite PK's leading rfq_id column
-- already indexes the reference.

alter table rfq_vendor_quotes
  add constraint rfq_vendor_quotes_rfq_id_fkey
  foreign key (rfq_id) references rfqs(id) on delete cascade;
