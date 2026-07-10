/**
 * The inventory posting kernel — TS façade (W2-2.5, kickoff Item 2d).
 *
 * `post_stock_movement()` in Postgres is THE single balance-mutation primitive:
 * it validates the type contract, writes the ledger row, and moves
 * on_hand / on_hold / in_transit / avg_unit_cost atomically under the level
 * row lock. The domain RPCs (receive, issue, adjust, cycle-count close,
 * hold/release, onboarding seed) all post through it inside their own
 * orchestration; app code reaches those through their existing cores
 * (`src/lib/scorecards/receive.ts`, `src/lib/storeroom/post.ts`).
 *
 * This module is the kernel's TS surface for the two entries that had no core
 * yet:
 *   * `postStockHold`      — hold / release (the on_hold bucket, Item 2c)
 *   * `recordStockMovements` — the append-only ingestion door (CSV import +
 *     QBO sync). Balance-NEUTRAL by design: imported history is already
 *     reflected in imported on-hand; replaying it into balances would
 *     double-count. Idempotent on (tenant, source, source_ref, occurred_at).
 *
 * No module writes `inventory_levels` or inserts `stock_movements` any other
 * way — the member RLS write policies are gone (W2-2.5 migration), so the
 * service-role RPC path is the only door. Authorization happens at the action
 * gate before any of these run, same as every movement writer since Block 11b.
 */

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export type HoldMovement = 'hold' | 'release';

export interface HoldParams {
  tenantId: string;
  locationId: string;
  productId: string;
  movement: HoldMovement;
  /** Units moved into or out of the held bucket — always positive. */
  qty: number;
  reasonCode: string;
  note?: string | null;
  actorUserId: string;
  idempotencyKey: string;
}

export type HoldResult =
  | { ok: true; applied: boolean; onHand: number | null; onHold: number | null }
  | { ok: false; error: string };

const HOLD_RPC_ERRORS: Record<string, string> = {
  bad_movement: 'That movement is not a hold or release.',
  bad_qty: 'Quantity must be greater than zero.',
  missing_reason: 'Pick a reason for the hold.',
  insufficient_stock_to_hold: 'Not enough unheld stock at this location to hold that quantity.',
  insufficient_held: 'That would release more than is currently held.',
};

interface HoldRpcRow {
  out_applied: boolean;
  out_on_hand: number | string | null;
  out_on_hold: number | string | null;
}

export async function postStockHold(
  admin: SupabaseClient,
  params: HoldParams,
): Promise<HoldResult> {
  const { data, error } = await admin.rpc('post_stock_hold', {
    p_tenant: params.tenantId,
    p_location: params.locationId,
    p_product: params.productId,
    p_movement: params.movement,
    p_qty: params.qty,
    p_reason_code: params.reasonCode,
    p_note: params.note ?? null,
    p_actor: params.actorUserId,
    p_idempotency_key: params.idempotencyKey,
  });

  if (error) {
    const mapped = HOLD_RPC_ERRORS[error.message];
    return { ok: false, error: mapped ?? 'The hold could not be posted. Try again.' };
  }

  const row = (Array.isArray(data) ? data[0] : data) as HoldRpcRow | undefined;
  if (!row) return { ok: false, error: 'The hold could not be posted. Try again.' };
  return {
    ok: true,
    applied: row.out_applied,
    onHand: row.out_on_hand === null ? null : Number(row.out_on_hand),
    onHold: row.out_on_hold === null ? null : Number(row.out_on_hold),
  };
}

export interface HistoricalMovementRow {
  product_id: string;
  location_id: string;
  type: string;
  quantity: number;
  source: string;
  source_ref: string;
  occurred_at: string;
}

export type RecordResult = { ok: true; inserted: number } | { ok: false; error: string };

/**
 * Append historical movements through the kernel's ingestion door. The rows
 * ride as one set-based call; duplicates on the (tenant, source, source_ref,
 * occurred_at) natural key are skipped, never doubled.
 */
export async function recordStockMovements(
  admin: SupabaseClient,
  tenantId: string,
  rows: HistoricalMovementRow[],
): Promise<RecordResult> {
  if (rows.length === 0) return { ok: true, inserted: 0 };

  const { data, error } = await admin.rpc('record_stock_movements', {
    p_tenant: tenantId,
    p_rows: rows,
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true, inserted: Number(data ?? 0) };
}
