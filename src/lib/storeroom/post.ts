/**
 * Storeroom operator posting cores (W2-2) — server-only wrappers over the three
 * atomic RPCs (`post_issue_movements`, `post_stock_adjustment`,
 * `close_cycle_count_session`). Same shape as the PO receipt core
 * (`src/lib/scorecards/receive.ts`): the RPC runs SECURITY INVOKER under the
 * service-role client, movements + inventory_levels move together, and every
 * call is idempotent on a caller-stable key. Authorization happens at the
 * action gate (owner/manager/warehouse per MG's locked decision).
 *
 * These are the posting-kernel prototypes Item 2d later unifies: no caller
 * anywhere writes `inventory_levels` directly.
 */

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DemandRefType } from './constants';

export interface IssueLineInput {
  productId: string;
  /** Units issued in this event — always positive; the RPC applies the sign. */
  qty: number;
}

export interface IssueParams {
  tenantId: string;
  locationId: string;
  movement: 'issue_out' | 'issue_return';
  demandRefType: DemandRefType;
  demandRefId: string;
  reasonCode?: string | null;
  note?: string | null;
  lines: IssueLineInput[];
  actorUserId: string;
  idempotencyKey: string;
}

export type IssueResult =
  | { ok: true; applied: boolean; lines: number; totalQty: number }
  | { ok: false; error: string };

const ISSUE_RPC_ERRORS: Record<string, string> = {
  bad_movement: 'That movement type is not an issue.',
  bad_demand_ref_type: 'Pick what the material is issued to.',
  missing_demand_ref: 'Enter the work order, crew, or cost center reference.',
  no_lines: 'Add at least one item to issue.',
  bad_qty: 'Quantities must be greater than zero.',
};

export async function postIssue(admin: SupabaseClient, params: IssueParams): Promise<IssueResult> {
  const { data, error } = await admin.rpc('post_issue_movements', {
    p_tenant: params.tenantId,
    p_location: params.locationId,
    p_movement: params.movement,
    p_demand_ref_type: params.demandRefType,
    p_demand_ref_id: params.demandRefId,
    p_reason_code: params.reasonCode ?? null,
    p_note: params.note ?? null,
    p_lines: params.lines.map((l) => ({ product_id: l.productId, qty: l.qty })),
    p_actor: params.actorUserId,
    p_idempotency_key: params.idempotencyKey,
  });
  if (error) {
    const code = (error.message.match(
      /\b(bad_movement|bad_demand_ref_type|missing_demand_ref|no_lines|bad_qty)\b/,
    ) ?? [])[1];
    return { ok: false, error: (code && ISSUE_RPC_ERRORS[code]) || 'Could not record the issue.' };
  }
  const row = (data as { out_applied: boolean; out_lines: number; out_total_qty: number }[])?.[0];
  if (!row) return { ok: false, error: 'Could not record the issue.' };
  return {
    ok: true,
    applied: row.out_applied,
    lines: Number(row.out_lines),
    totalQty: Number(row.out_total_qty),
  };
}

export interface AdjustmentParams {
  tenantId: string;
  locationId: string;
  productId: string;
  /** Signed correction applied to on_hand. */
  delta: number;
  reasonCode: string;
  note?: string | null;
  actorUserId: string;
  idempotencyKey: string;
}

export type AdjustmentResult =
  | { ok: true; applied: boolean; onHand: number | null }
  | { ok: false; error: string };

const ADJUST_RPC_ERRORS: Record<string, string> = {
  bad_qty: 'Enter a non-zero adjustment.',
  missing_reason: 'Pick a reason for the adjustment.',
};

export async function postAdjustment(
  admin: SupabaseClient,
  params: AdjustmentParams,
): Promise<AdjustmentResult> {
  const { data, error } = await admin.rpc('post_stock_adjustment', {
    p_tenant: params.tenantId,
    p_location: params.locationId,
    p_product: params.productId,
    p_delta: params.delta,
    p_reason_code: params.reasonCode,
    p_note: params.note ?? null,
    p_actor: params.actorUserId,
    p_idempotency_key: params.idempotencyKey,
  });
  if (error) {
    const code = (error.message.match(/\b(bad_qty|missing_reason)\b/) ?? [])[1];
    return {
      ok: false,
      error: (code && ADJUST_RPC_ERRORS[code]) || 'Could not record the adjustment.',
    };
  }
  const row = (data as { out_applied: boolean; out_on_hand: number | null }[])?.[0];
  if (!row) return { ok: false, error: 'Could not record the adjustment.' };
  return {
    ok: true,
    applied: row.out_applied,
    onHand: row.out_on_hand === null ? null : Number(row.out_on_hand),
  };
}

export interface CloseCountParams {
  tenantId: string;
  sessionId: string;
  actorUserId: string;
  idempotencyKey: string;
}

export type CloseCountResult =
  | { ok: true; applied: boolean; lines: number; movements: number; absVariance: number }
  | { ok: false; error: string };

const CLOSE_RPC_ERRORS: Record<string, string> = {
  session_not_found: 'That count session was not found.',
  session_terminal: 'That count session is already closed.',
  nothing_counted: 'Count at least one item before closing the session.',
};

export async function closeCycleCount(
  admin: SupabaseClient,
  params: CloseCountParams,
): Promise<CloseCountResult> {
  const { data, error } = await admin.rpc('close_cycle_count_session', {
    p_tenant: params.tenantId,
    p_session: params.sessionId,
    p_actor: params.actorUserId,
    p_idempotency_key: params.idempotencyKey,
  });
  if (error) {
    const code = (error.message.match(/\b(session_not_found|session_terminal|nothing_counted)\b/) ??
      [])[1];
    return {
      ok: false,
      error: (code && CLOSE_RPC_ERRORS[code]) || 'Could not close the count session.',
    };
  }
  const row = (
    data as {
      out_applied: boolean;
      out_lines: number;
      out_movements: number;
      out_abs_variance: number;
    }[]
  )?.[0];
  if (!row) return { ok: false, error: 'Could not close the count session.' };
  return {
    ok: true,
    applied: row.out_applied,
    lines: Number(row.out_lines),
    movements: Number(row.out_movements),
    absVariance: Number(row.out_abs_variance),
  };
}
