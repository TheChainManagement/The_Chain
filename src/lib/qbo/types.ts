/**
 * QuickBooks Online API response shapes (the subset Wave 1 reads + writes).
 *
 * These mirror Intuit's v3 Accounting API JSON. Only the fields The Chain maps
 * are typed; everything else QBO returns is ignored. Mappers (`map.ts`) treat
 * every field as untrusted — a missing required field becomes a `PullResultError`,
 * never a thrown exception, so one malformed record can't sink a whole pull.
 */

/** Common Intuit metadata block — carries the incremental-sync watermark. */
export interface QboMetaData {
  CreateTime?: string;
  LastUpdatedTime?: string;
}

/** A typed reference to another QBO entity (vendor, item, etc.). */
export interface QboRef {
  value: string;
  name?: string;
}

/** Item — maps to a canonical `product`. Type 'Inventory' is the stock case. */
export interface QboItem {
  Id: string;
  Name: string;
  Sku?: string;
  Description?: string;
  Active?: boolean;
  Type?: 'Inventory' | 'NonInventory' | 'Service' | string;
  UnitPrice?: number;
  PurchaseCost?: number;
  QtyOnHand?: number;
  InvStartDate?: string;
  MetaData?: QboMetaData;
}

/** Vendor — maps to a canonical `supplier`. */
export interface QboVendor {
  Id: string;
  DisplayName?: string;
  CompanyName?: string;
  Active?: boolean;
  PrimaryEmailAddr?: { Address?: string };
  PrimaryPhone?: { FreeFormNumber?: string };
  WebAddr?: { URI?: string };
  MetaData?: QboMetaData;
}

/** A line on a purchase order or bill that references a stock item. */
export interface QboItemExpenseLine {
  Id?: string;
  Amount?: number;
  DetailType?: string;
  ItemBasedExpenseLineDetail?: {
    ItemRef?: QboRef;
    Qty?: number;
    UnitPrice?: number;
  };
}

/** A line on a sales receipt or invoice that sells a stock item. */
export interface QboSalesLine {
  Id?: string;
  Amount?: number;
  DetailType?: string;
  SalesItemLineDetail?: {
    ItemRef?: QboRef;
    Qty?: number;
    UnitPrice?: number;
  };
}

/** PurchaseOrder — maps to a canonical `purchase_order` (and is the push target). */
export interface QboPurchaseOrder {
  Id: string;
  SyncToken?: string;
  DocNumber?: string;
  VendorRef?: QboRef;
  POStatus?: 'Open' | 'Closed' | string;
  TotalAmt?: number;
  TxnDate?: string;
  DueDate?: string;
  PrivateNote?: string;
  Line?: QboItemExpenseLine[];
  MetaData?: QboMetaData;
}

/** Bill — a received purchase; each item line maps to a `receipt` stock movement. */
export interface QboBill {
  Id: string;
  VendorRef?: QboRef;
  TxnDate?: string;
  Line?: QboItemExpenseLine[];
  MetaData?: QboMetaData;
}

/** SalesReceipt / Invoice — each item line maps to a `sale` stock movement. */
export interface QboSalesTxn {
  Id: string;
  TxnDate?: string;
  Line?: QboSalesLine[];
  MetaData?: QboMetaData;
}

/**
 * The envelope every QBO query returns. The entity arrays are keyed by entity
 * name (`Item`, `Vendor`, ...); `maxResults`/`startPosition` drive pagination.
 */
export interface QboQueryResponse {
  QueryResponse?: {
    Item?: QboItem[];
    Vendor?: QboVendor[];
    PurchaseOrder?: QboPurchaseOrder[];
    Bill?: QboBill[];
    SalesReceipt?: QboSalesTxn[];
    Invoice?: QboSalesTxn[];
    startPosition?: number;
    maxResults?: number;
    totalCount?: number;
  };
  time?: string;
}

/** A single create/read response (e.g. POSTing a PurchaseOrder). */
export interface QboEntityResponse {
  PurchaseOrder?: QboPurchaseOrder;
  time?: string;
}

/** Intuit's fault envelope on a 4xx/5xx. */
export interface QboFaultResponse {
  Fault?: {
    Error?: Array<{ Message?: string; Detail?: string; code?: string }>;
    type?: string;
  };
  time?: string;
}
