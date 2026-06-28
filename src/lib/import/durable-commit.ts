/**
 * Durable CSV import write core (Block 5, Wave 5.2-durable).
 *
 * The large-file counterpart to `commit.ts`. Runs INSIDE a Workflow DevKit step,
 * which is detached from the user's login session, so every write goes through
 * the service-role admin client with `tenant_id` set explicitly. Authorization
 * already happened at the Server Action gate before the workflow was started
 * (same trust model as the QBO/cron workflows in SYSTEM_DESIGN §Workflows).
 *
 * Two properties make it crash-safe:
 *   - **Idempotent writes** — products upsert on (tenant_id, sku), suppliers on
 *     (tenant_id, lower(name)) resolved to id, movements skip on the content-hash
 *     source_ref. So a step that is retried after a crash converges to the same
 *     final state (FEATURES.md: "ends with the same final state as a clean run").
 *   - **Cursor resume** — progress (processed/total) is written to
 *     `sync_runs.cursor` after every batch; a retry skips the rows already past
 *     the cursor, so the work isn't redone, just finished.
 *
 * The idempotency-critical `source_ref`/date logic is shared with the synchronous
 * path via `writers-shared.ts`, so a file imported synchronously and re-uploaded
 * here collides on the same key.
 */

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CanonicalPayload, PullResultError } from '@/lib/source-adapter';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { ensurePrimaryLocation, type ImportFailure, type ImportSummary } from './commit';
import { CsvSourceAdapter } from './csv-adapter';
import type { ImportableKind } from './field-specs';
import type { ColumnMapping } from './mapping';
import { movementSourceRef, parseOccurredAt } from './writers-shared';

/** Rows per DB round-trip. Bounds memory + gives progress granularity. */
const BATCH = 500;
const FAILURE_PREVIEW = 20;

export interface RunDurableParams {
  tenantId: string;
  kind: ImportableKind;
  csvText: string;
  mapping: ColumnMapping;
  /** Pre-created by the action so polling can find the run immediately. */
  syncRunId: string;
}

/** One writable DB row plus the bookkeeping a batched upsert needs. */
interface PreparedWrite {
  /** DB rows in stable CSV order (resume skips a prefix of these). */
  rows: Record<string, unknown>[];
  /** Per-row writer failures (unknown SKU, unreadable date). */
  rowErrors: PullResultError[];
  /** Upsert one batch; returns how many were newly written (vs. skipped dupes). */
  writeBatch: (batch: Record<string, unknown>[]) => Promise<number>;
}

export async function runImportDurable(params: RunDurableParams): Promise<ImportSummary> {
  const { syncRunId } = params;
  const admin = createSupabaseAdmin();
  try {
    return await runImportDurableInner(admin, params);
  } catch (err) {
    // Mark the run failed so the poller surfaces it instead of spinning to the
    // soft cap. CSV-import failures are deterministic in practice (bad data /
    // schema / permission), so this is correct for the common case; a successful
    // later retry overwrites to completed via finalize(). Precise
    // Retryable-vs-Fatal classification (to avoid a transient false-failure flash
    // before a retry succeeds) is ticketed.
    await markFailed(admin, syncRunId, err);
    throw err;
  }
}

async function runImportDurableInner(
  admin: SupabaseClient,
  params: RunDurableParams,
): Promise<ImportSummary> {
  const { tenantId, kind, csvText, mapping, syncRunId } = params;

  const adapter = new CsvSourceAdapter({ [kind]: { csvText, mapping } });
  const pull = await adapter.pull(kind, null, syncRunId);

  const prepared = await prepareWrites(admin, kind, tenantId, pull.items);
  const total = prepared.rows.length;

  // Resume point: how many rows a prior (crashed) attempt already got through.
  const startAt = await readProcessed(admin, syncRunId);
  let imported = 0;
  let skipped = 0;

  // Re-count the already-done prefix as written so the final summary is whole
  // even on a resumed run (idempotent upserts make re-counting safe to skip).
  for (let offset = 0; offset < total; offset += BATCH) {
    const batch = prepared.rows.slice(offset, offset + BATCH);
    if (offset + batch.length <= startAt) {
      // Whole batch already committed by a prior attempt — count, don't rewrite.
      imported += batch.length;
      continue;
    }
    const written = await prepared.writeBatch(batch);
    imported += written;
    skipped += batch.length - written;
    await writeProgress(admin, syncRunId, kind, offset + batch.length, total);
  }

  const allErrors: PullResultError[] = [...pull.errors, ...prepared.rowErrors];
  if (allErrors.length > 0) {
    await admin.from('sync_failures').insert(
      allErrors.map((e) => ({
        tenant_id: tenantId,
        sync_run_id: syncRunId,
        entity_type: kind,
        external_ref: e.externalId ?? null,
        payload: e.row != null ? { row: e.row } : null,
        error_code: e.code,
        error_message: e.message,
      })),
    );
  }

  const failures: ImportFailure[] = allErrors.slice(0, FAILURE_PREVIEW).map((e) => ({
    row: e.row ?? (Number(e.externalId) || 0),
    message: e.message,
  }));

  const summary: ImportSummary = {
    syncRunId,
    imported,
    skipped,
    failed: allErrors.length,
    total: imported + skipped + allErrors.length,
    failures,
  };

  await finalize(admin, syncRunId, kind, total, summary);
  return summary;
}

async function prepareWrites(
  admin: SupabaseClient,
  kind: ImportableKind,
  tenantId: string,
  items: CanonicalPayload[],
): Promise<PreparedWrite> {
  switch (kind) {
    case 'product':
      return prepareProducts(admin, tenantId, items);
    case 'supplier':
      return prepareSuppliers(admin, tenantId, items);
    case 'stock_movement':
      return prepareMovements(admin, tenantId, items);
    case 'product_supplier':
      // Links run synchronously (W2-1a) — the import action guards this kind off
      // the durable path. Reaching here means that guard regressed.
      throw new Error('Product-supplier link import is not supported on the durable path.');
  }
}

function prepareProducts(
  admin: SupabaseClient,
  tenantId: string,
  items: CanonicalPayload[],
): PreparedWrite {
  const rows = items.map((item) => {
    const a = item.attributes as {
      sku: string;
      name: string;
      description?: string;
      unitOfMeasure?: string;
      status: 'active' | 'discontinued';
    };
    return {
      tenant_id: tenantId,
      sku: a.sku,
      name: a.name,
      description: a.description ?? null,
      unit_of_measure: a.unitOfMeasure ?? null,
      status: a.status,
      external_ids: { csv: a.sku },
    };
  });

  return {
    rows,
    rowErrors: [],
    writeBatch: async (batch) => {
      const { data, error } = await admin
        .from('products')
        .upsert(batch, { onConflict: 'tenant_id,sku' })
        .select('id')
        .returns<{ id: string }[]>();
      if (error) throw new Error(`products upsert failed: ${error.message}`);
      return data?.length ?? 0;
    },
  };
}

async function prepareSuppliers(
  admin: SupabaseClient,
  tenantId: string,
  items: CanonicalPayload[],
): Promise<PreparedWrite> {
  // No JWT in a workflow, so the case-insensitive RPC can't run; resolve
  // lower(name)->id ourselves and upsert on the (tenant_id, id) primary key.
  const { data: existing } = await admin
    .from('suppliers')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .returns<{ id: string; name: string }[]>();
  const byLowerName = new Map((existing ?? []).map((s) => [s.name.toLowerCase(), s.id]));

  const rows = items.map((item) => {
    const a = item.attributes as {
      name: string;
      defaultLeadTimeDays?: number;
      minOrderValue?: number;
      status: 'active' | 'archived';
    };
    const existingId = byLowerName.get(a.name.toLowerCase());
    const row: Record<string, unknown> = {
      tenant_id: tenantId,
      name: a.name,
      default_lead_time_days: a.defaultLeadTimeDays ?? null,
      min_order_value: a.minOrderValue ?? null,
      status: a.status,
      external_ids: { csv: a.name },
    };
    if (existingId) row.id = existingId;
    return row;
  });

  return {
    rows,
    rowErrors: [],
    writeBatch: async (batch) => {
      const { data, error } = await admin
        .from('suppliers')
        .upsert(batch, { onConflict: 'tenant_id,id' })
        .select('id')
        .returns<{ id: string }[]>();
      if (error) throw new Error(`suppliers upsert failed: ${error.message}`);
      return data?.length ?? 0;
    },
  };
}

async function prepareMovements(
  admin: SupabaseClient,
  tenantId: string,
  items: CanonicalPayload[],
): Promise<PreparedWrite> {
  const skus = [
    ...new Set(items.map((i) => (i.attributes as { productExternalId: string }).productExternalId)),
  ];
  const { data: prods } = await admin
    .from('products')
    .select('id, sku')
    .eq('tenant_id', tenantId)
    .in('sku', skus)
    .returns<{ id: string; sku: string }[]>();
  const skuToId = new Map((prods ?? []).map((p) => [p.sku, p.id]));

  const rowErrors: PullResultError[] = [];
  const staged: Record<string, unknown>[] = [];

  for (const item of items) {
    const a = item.attributes as {
      productExternalId: string;
      type: string;
      quantity: number;
      occurredAt: string;
    };
    const productId = skuToId.get(a.productExternalId);
    if (!productId) {
      rowErrors.push({
        externalId: a.productExternalId,
        row: item.sourceRow,
        code: 'unknown_sku',
        message: `No SKU "${a.productExternalId}" in your catalog. Import that product first.`,
      });
      continue;
    }
    const occurredIso = parseOccurredAt(a.occurredAt);
    if (occurredIso === null) {
      rowErrors.push({
        externalId: a.productExternalId,
        row: item.sourceRow,
        code: 'invalid_date',
        message: `Movement for "${a.productExternalId}" has an unreadable date "${a.occurredAt}".`,
      });
      continue;
    }
    staged.push({
      tenant_id: tenantId,
      product_id: productId,
      type: a.type,
      quantity: a.quantity,
      source: 'csv',
      source_ref: movementSourceRef(a.productExternalId, a.type, a.quantity, occurredIso),
      occurred_at: occurredIso,
    });
  }

  // Only provision the Primary location when there is something to write.
  let locationId: string | null = null;
  if (staged.length > 0) {
    locationId = await ensurePrimaryLocation(admin, tenantId);
  }
  const rows = staged.map((r) => ({ ...r, location_id: locationId }));

  return {
    rows,
    rowErrors,
    writeBatch: async (batch) => {
      const { data, error } = await admin
        .from('stock_movements')
        .upsert(batch, {
          onConflict: 'tenant_id,source,source_ref,occurred_at',
          ignoreDuplicates: true,
        })
        .select('id')
        .returns<{ id: string }[]>();
      if (error) throw new Error(`stock_movements upsert failed: ${error.message}`);
      return data?.length ?? 0;
    },
  };
}

async function readProcessed(admin: SupabaseClient, syncRunId: string): Promise<number> {
  const { data } = await admin
    .from('sync_runs')
    .select('cursor')
    .eq('id', syncRunId)
    .single<{ cursor: { processed?: number } | null }>();
  return data?.cursor?.processed ?? 0;
}

async function writeProgress(
  admin: SupabaseClient,
  syncRunId: string,
  kind: ImportableKind,
  processed: number,
  total: number,
): Promise<void> {
  await admin.from('sync_runs').update({ cursor: { processed, total, kind } }).eq('id', syncRunId);
}

async function markFailed(admin: SupabaseClient, syncRunId: string, err: unknown): Promise<void> {
  await admin
    .from('sync_runs')
    .update({
      status: 'failed',
      finished_at: new Date().toISOString(),
      error_log: [err instanceof Error ? err.message : String(err)],
    })
    .eq('id', syncRunId);
}

async function finalize(
  admin: SupabaseClient,
  syncRunId: string,
  kind: ImportableKind,
  total: number,
  summary: ImportSummary,
): Promise<void> {
  await admin
    .from('sync_runs')
    .update({
      status: 'completed',
      finished_at: new Date().toISOString(),
      entities_processed: { [kind]: summary.imported },
      // Stash the final counts in the cursor so the progress poller can hand the
      // done screen its summary without reading the workflow's return value.
      cursor: {
        processed: total,
        total,
        kind,
        done: true,
        imported: summary.imported,
        skipped: summary.skipped,
        failed: summary.failed,
      },
      error_log: [],
    })
    .eq('id', syncRunId);
}
