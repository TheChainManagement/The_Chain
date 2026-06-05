/**
 * QboSourceAdapter (Block 6) — the native two-way `SourceAdapter`.
 *
 * Same contract as `CsvSourceAdapter`, so everything downstream (workflow steps,
 * the commit path, forecasting) reads canonical payloads and never knows the data
 * came from QuickBooks. `pull()` runs one QBO Query API page per call (the natural
 * `"use step"` granularity) and returns a `Cursor` the workflow persists to
 * `sync_runs.cursor`, so a crashed sync resumes mid-pagination. `push()` writes a
 * generated PO back, idempotent via a `DocNumber` round-trip lookup.
 *
 * The `stock_movement` kind fans across three QBO entities (Bill → receipts,
 * SalesReceipt + Invoice → sales); the cursor walks them in sequence so each
 * pull stays a single query.
 */

import {
  type CanonicalPayload,
  type Cursor,
  type EntityKind,
  FatalError,
  type PullResult,
  type PushResult,
  type SourceAdapter,
} from '@/lib/source-adapter';
import { QBO_CAPABILITIES } from './capabilities';
import type { QboClient } from './client';
import {
  buildQboPurchaseOrder,
  type MapResult,
  mapBills,
  mapItems,
  mapPurchaseOrders,
  mapSalesTxns,
  mapVendors,
  poDocNumber,
} from './map';
import type {
  QboBill,
  QboItem,
  QboMetaData,
  QboPurchaseOrder,
  QboQueryResponse,
  QboSalesTxn,
  QboVendor,
} from './types';

const DEFAULT_PAGE_SIZE = 100; // QBO MAXRESULTS cap is 1000; 100 keeps each step quick.

/** Single-entity kinds: one QBO entity, paginated by STARTPOSITION. */
const ENTITY_BY_KIND: Partial<Record<EntityKind, 'Item' | 'Vendor' | 'PurchaseOrder'>> = {
  product: 'Item',
  supplier: 'Vendor',
  purchase_order: 'PurchaseOrder',
};

/** stock_movement walks these QBO entities in order, one page at a time. */
const MOVEMENT_ENTITIES = ['Bill', 'SalesReceipt', 'Invoice'] as const;
type MovementEntity = (typeof MOVEMENT_ENTITIES)[number];

/**
 * `floor` is the incremental filter for THIS pull chain — fixed at sync start and
 * held constant across every page. It is NOT the advancing high-watermark: using
 * the advancing watermark as the WHERE bound while also advancing STARTPOSITION
 * shifts the filtered set between pages and silently drops records. The running
 * max lives in `Cursor.highWatermark` (persisted for the next sync) and never
 * touches the query.
 */
interface PageCursor {
  startPosition: number;
  floor?: string;
}
interface MovementCursor {
  entity: MovementEntity;
  startPosition: number;
  floor?: string;
}

export class QboSourceAdapter implements SourceAdapter {
  readonly source = 'qbo' as const;
  readonly capabilities = QBO_CAPABILITIES;

  constructor(
    private readonly client: QboClient,
    private readonly tenantId: string,
    private readonly pageSize: number = DEFAULT_PAGE_SIZE,
  ) {}

  async pull<E extends EntityKind>(
    kind: E,
    cursor: Cursor | null,
    _idempotencyKey: string,
  ): Promise<PullResult<E>> {
    if (kind === 'stock_movement') {
      return (await this.pullMovements(cursor)) as PullResult<E>;
    }

    const entity = ENTITY_BY_KIND[kind];
    if (!entity) {
      throw new FatalError(`QBO does not read "${kind}".`, { code: 'unsupported_kind' });
    }

    const page = cursor?.raw as PageCursor | undefined;
    const startPosition = page?.startPosition ?? 1;
    const floor = page?.floor; // constant across the whole pull chain
    const statement = buildStatement(entity, startPosition, this.pageSize, floor);
    const res = await this.client.query(statement);
    const rows = entityRows(res, entity);

    const mapped =
      kind === 'product'
        ? mapItems(rows as QboItem[])
        : kind === 'supplier'
          ? mapVendors(rows as QboVendor[])
          : mapPurchaseOrders(rows as QboPurchaseOrder[]);

    const highWatermark = advanceWatermark(
      cursor?.highWatermark,
      rows as { MetaData?: QboMetaData }[],
    );
    const nextCursor =
      rows.length < this.pageSize
        ? null
        : {
            raw: { startPosition: startPosition + this.pageSize, floor } satisfies PageCursor,
            highWatermark,
          };

    return {
      items: mapped.items as CanonicalPayload<E>[],
      nextCursor,
      errors: mapped.errors,
    };
  }

  /** Walk Bill → SalesReceipt → Invoice in sequence, one page per call. */
  private async pullMovements(cursor: Cursor | null): Promise<PullResult<'stock_movement'>> {
    const cur = (cursor?.raw as MovementCursor | undefined) ?? {
      entity: 'Bill' as MovementEntity,
      startPosition: 1,
    };

    const statement = buildStatement(cur.entity, cur.startPosition, this.pageSize, cur.floor);
    const res = await this.client.query(statement);
    const rows = entityRows(res, cur.entity);

    const mapped: MapResult<'stock_movement'> =
      cur.entity === 'Bill' ? mapBills(rows as QboBill[]) : mapSalesTxns(rows as QboSalesTxn[]);

    const highWatermark = advanceWatermark(
      cursor?.highWatermark,
      rows as { MetaData?: QboMetaData }[],
    );
    const moreInEntity = rows.length >= this.pageSize;
    const nextEntity = MOVEMENT_ENTITIES[MOVEMENT_ENTITIES.indexOf(cur.entity) + 1];

    let nextCursor: Cursor | null;
    if (moreInEntity) {
      nextCursor = {
        raw: {
          entity: cur.entity,
          startPosition: cur.startPosition + this.pageSize,
          floor: cur.floor,
        } satisfies MovementCursor,
        highWatermark,
      };
    } else if (nextEntity) {
      // New entity restarts pagination but keeps the same incremental floor.
      nextCursor = {
        raw: { entity: nextEntity, startPosition: 1, floor: cur.floor } satisfies MovementCursor,
        highWatermark,
      };
    } else {
      nextCursor = null; // Invoice exhausted → movements done.
    }

    return { items: mapped.items, nextCursor, errors: mapped.errors };
  }

  /**
   * Write a generated PO back to QBO. Idempotent: a deterministic `DocNumber`
   * (derived from our internal PO id) is looked up first, so a retried push with
   * the same payload finds the existing record and never creates a duplicate.
   */
  async push(
    kind: 'purchase_order',
    payload: CanonicalPayload<'purchase_order'>,
    _idempotencyKey: string,
  ): Promise<PushResult> {
    if (kind !== 'purchase_order') {
      throw new FatalError(`QBO write-back supports purchase_order only, not "${kind}".`, {
        code: 'write_unsupported',
      });
    }

    const docNumber = poDocNumber(payload.externalId);
    const lookup = await this.client.query(
      `SELECT Id, SyncToken, MetaData FROM PurchaseOrder WHERE DocNumber = '${docNumber}'`,
    );
    const existing = lookup.QueryResponse?.PurchaseOrder?.[0];
    if (existing) {
      return toPushResult(existing);
    }

    const created = await this.client.createPurchaseOrder(
      buildQboPurchaseOrder(payload, this.tenantId),
    );
    return toPushResult(created);
  }
}

// ----- helpers -----

function buildStatement(
  entity: string,
  startPosition: number,
  pageSize: number,
  floor?: string,
): string {
  // `floor` is constant for the whole pull chain (the incremental sync's start
  // watermark), so STARTPOSITION paginates a stable filtered set — no drops.
  const where = floor ? ` WHERE Metadata.LastUpdatedTime > '${floor}'` : '';
  return `SELECT * FROM ${entity}${where} ORDERBY Id STARTPOSITION ${startPosition} MAXRESULTS ${pageSize}`;
}

function entityRows(res: QboQueryResponse, entity: string): unknown[] {
  const qr = res.QueryResponse as Record<string, unknown> | undefined;
  const rows = qr?.[entity];
  return Array.isArray(rows) ? rows : [];
}

/** Carry the latest external_updated_at forward for the next incremental sync. */
function advanceWatermark(
  prev: string | undefined,
  rows: { MetaData?: QboMetaData }[],
): string | undefined {
  let max = prev;
  for (const r of rows) {
    const t = r.MetaData?.LastUpdatedTime;
    if (t && (!max || t > max)) max = t;
  }
  return max;
}

function toPushResult(po: QboPurchaseOrder): PushResult {
  return {
    externalId: po.Id,
    externalVersion: Number(po.SyncToken ?? 0),
    appliedAt: po.MetaData?.LastUpdatedTime ?? new Date().toISOString(),
  };
}
