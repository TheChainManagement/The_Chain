/**
 * Pending sync-conflict queries + diff shaping (Block 6, Wave 6.3-C).
 *
 * The incremental sync logs a `needs_review` conflict (KEEPING the local record)
 * whenever both sides changed a QBO-owned field and the clocks can't pick a
 * winner. This module loads those open rows for the `/flow/sync-conflicts`
 * cockpit and shapes each into a field-by-field local-vs-remote diff so the
 * operator sees exactly what diverged before they adjudicate.
 *
 * Read path only — RLS scopes selects to owner/manager of the tenant.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { type ConflictEntityType, fieldsFor } from './resolve';

export interface ConflictField {
  key: string;
  label: string;
  /** Display strings for the bench. */
  local: string;
  remote: string;
  /** Whether the two sides actually differ on this field. */
  differs: boolean;
}

export interface PendingConflict {
  id: string;
  entityType: ConflictEntityType;
  entityId: string | null;
  externalRef: string | null;
  /** Entity display name (from local_state, falls back to remote_state). */
  title: string;
  /** Secondary line, e.g. a product SKU. */
  subtitle: string | null;
  policyDecision: string;
  createdAt: string;
  fields: ConflictField[];
  /** Raw states the cockpit needs to build a per-field merge payload. */
  localState: Record<string, unknown>;
  remoteState: Record<string, unknown>;
}

interface ConflictRow {
  id: string;
  entity_type: string;
  entity_id: string | null;
  external_ref: string | null;
  local_state: Record<string, unknown> | null;
  remote_state: Record<string, unknown> | null;
  policy_decision: string;
  created_at: string;
}

/** Open conflicts awaiting an operator decision, newest first. RLS-scoped. */
export async function listPendingConflicts(supabase: SupabaseClient): Promise<PendingConflict[]> {
  const { data, error } = await supabase
    .from('sync_conflicts')
    .select(
      'id, entity_type, entity_id, external_ref, local_state, remote_state, policy_decision, created_at',
    )
    .eq('applied_resolution', 'pending')
    .order('created_at', { ascending: false })
    .returns<ConflictRow[]>();
  if (error) throw new Error(`could not load sync conflicts: ${error.message}`);

  const rows = data ?? [];

  // Enrich products with their SKU for the subtitle (one batched query).
  const productIds = rows
    .filter((r) => r.entity_type === 'product' && r.entity_id)
    .map((r) => r.entity_id as string);
  const skuById = new Map<string, string>();
  if (productIds.length > 0) {
    const { data: prods } = await supabase
      .from('products')
      .select('id, sku')
      .in('id', productIds)
      .returns<{ id: string; sku: string | null }[]>();
    for (const p of prods ?? []) if (p.sku) skuById.set(p.id, p.sku);
  }

  return rows.filter(isKnownEntity).map((row) => shapeConflict(row, skuById));
}

function isKnownEntity(row: ConflictRow): boolean {
  return row.entity_type === 'product' || row.entity_type === 'supplier';
}

function shapeConflict(row: ConflictRow, skuById: Map<string, string>): PendingConflict {
  const entityType = row.entity_type as ConflictEntityType;
  const local = row.local_state ?? {};
  const remote = row.remote_state ?? {};

  const fields: ConflictField[] = fieldsFor(entityType).map((f) => {
    const localStr = display(local[f.key]);
    const remoteStr = display(remote[f.key]);
    return {
      key: f.key,
      label: f.label,
      local: localStr,
      remote: remoteStr,
      differs: localStr !== remoteStr,
    };
  });

  const title = display(local.name) || display(remote.name) || 'Unknown record';
  const subtitle =
    entityType === 'product' && row.entity_id ? (skuById.get(row.entity_id) ?? null) : null;

  return {
    id: row.id,
    entityType,
    entityId: row.entity_id,
    externalRef: row.external_ref,
    title,
    subtitle,
    policyDecision: row.policy_decision,
    createdAt: row.created_at,
    fields,
    localState: local,
    remoteState: remote,
  };
}

/** Render any stored field value (string, null, or a contact object) for the bench. */
function display(v: unknown): string {
  if (v == null || v === '') return '—';
  if (typeof v === 'object') {
    const parts = Object.entries(v as Record<string, unknown>)
      .filter(([, val]) => val != null && val !== '')
      .map(([k, val]) => `${k}: ${String(val)}`);
    return parts.length ? parts.join(' · ') : '—';
  }
  return String(v);
}
