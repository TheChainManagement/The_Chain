import type { AdapterCapabilities } from '@/lib/source-adapter';

/**
 * QuickBooks Online capabilities (FEATURES.md Block 6).
 *
 * QBO is the Wave 1 native two-way anchor: it reads items, vendors, purchase
 * orders, bills, and sales, and writes generated POs back. `webhooks` is true
 * because Intuit emits entity-changed callbacks (wired in Wave 6.3). Stored at
 * connect time in `source_connections.capabilities`; UI features gate on these
 * flags, so a future adapter without `writePurchaseOrders` simply hides the
 * write-back option.
 *
 * `readInventory` (canonical inventory_level from Item.QtyOnHand) is deferred to
 * a later wave; on-hand arrives via the movement ledger meanwhile.
 */
export const QBO_CAPABILITIES: AdapterCapabilities = {
  readProducts: true,
  readSuppliers: true,
  readProductSuppliers: false,
  readInventory: false,
  readPurchaseOrders: true,
  readStockMovements: true,
  writePurchaseOrders: true,
  webhooks: true,
};
