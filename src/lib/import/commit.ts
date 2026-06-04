/**
 * CSV import commit core (Block 5).
 *
 * The reusable engine the Server Action calls today and a Workflow `"use step"`
 * will wrap in Wave 5.2 (durable/resumable for the 50k path) — same function,
 * one extra orchestration caller, no rewrite.
 *
 * Split of authority:
 *   - Master-data rows (products) upsert through the caller's RLS client, so the
 *     tenant + owner/manager/planner gate is enforced at the data layer.
 *   - Bookkeeping (sync_runs, sync_failures) is "system mutate" in the RLS matrix
 *     (members are select-only), so it writes through the service-role admin
 *     client with tenant_id set explicitly to the already-verified tenant.
 *
 * Valid rows always commit; invalid rows land in sync_failures with their CSV row
 * number and never block the good ones. Re-importing the same products is
 * idempotent on the (tenant_id, sku) natural key — upsert updates, never dupes.
 */

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CanonicalPayload } from '@/lib/source-adapter';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { CsvSourceAdapter } from './csv-adapter';
import type { ImportableKind } from './field-specs';
import type { ColumnMapping } from './mapping';

export interface ImportFailure {
  row: number;
  message: string;
}

export interface ImportSummary {
  syncRunId: string;
  imported: number;
  failed: number;
  total: number;
  /** First slice of failures for the UI; full set lands in sync_failures. */
  failures: ImportFailure[];
}

const FAILURE_PREVIEW = 20;

export interface RunCsvImportParams {
  tenantClient: SupabaseClient;
  tenantId: string;
  kind: ImportableKind;
  csvText: string;
  mapping: ColumnMapping;
  idempotencyKey: string;
}

export async function runCsvImport(
  params: RunCsvImportParams,
): Promise<{ ok: true; summary: ImportSummary } | { ok: false; error: string }> {
  const { tenantClient, tenantId, kind, csvText, mapping, idempotencyKey } = params;

  if (kind !== 'product') {
    // Wave 5.1 ships the product writer; supplier + movement writers land in 5.2.
    return { ok: false, error: 'This import type is coming soon. Products are live today.' };
  }

  const adapter = new CsvSourceAdapter({ [kind]: { csvText, mapping } });
  const pull = await adapter.pull(kind, null, idempotencyKey);

  const admin = createSupabaseAdmin();
  const connectionId = await ensureCsvConnection(admin, tenantId, adapter.capabilities);

  const { data: runRow, error: runError } = await admin
    .from('sync_runs')
    .insert({
      tenant_id: tenantId,
      connection_id: connectionId,
      workflow_run_id: idempotencyKey,
      status: 'running',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single<{ id: string }>();

  if (runError || !runRow) {
    return { ok: false, error: 'Could not start the import. Please try again.' };
  }
  const syncRunId = runRow.id;

  // Upsert the valid rows through RLS (tenant + role enforced).
  const writeResult = await upsertProducts(tenantClient, tenantId, pull.items);
  if (!writeResult.ok) {
    await finalizeRun(admin, syncRunId, 'failed', 0, kind, [writeResult.error]);
    return { ok: false, error: writeResult.error };
  }

  // Record per-row validation failures (system table).
  if (pull.errors.length > 0) {
    await admin.from('sync_failures').insert(
      pull.errors.map((e) => ({
        tenant_id: tenantId,
        sync_run_id: syncRunId,
        entity_type: kind,
        external_ref: e.externalId ?? null,
        error_code: e.code,
        error_message: e.message,
      })),
    );
  }

  await finalizeRun(admin, syncRunId, 'completed', writeResult.count, kind, []);

  const failures: ImportFailure[] = pull.errors.slice(0, FAILURE_PREVIEW).map((e) => ({
    row: Number(e.externalId ?? 0),
    message: e.message,
  }));

  return {
    ok: true,
    summary: {
      syncRunId,
      imported: writeResult.count,
      failed: pull.errors.length,
      total: writeResult.count + pull.errors.length,
      failures,
    },
  };
}

async function ensureCsvConnection(
  admin: SupabaseClient,
  tenantId: string,
  capabilities: unknown,
): Promise<string> {
  const { data: existing } = await admin
    .from('source_connections')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('source', 'csv')
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (existing) return existing.id;

  const { data: created, error } = await admin
    .from('source_connections')
    .insert({
      tenant_id: tenantId,
      source: 'csv',
      status: 'active',
      capabilities,
    })
    .select('id')
    .single<{ id: string }>();

  if (error || !created) {
    throw new Error(`Could not create the CSV source connection: ${error?.message ?? 'unknown'}`);
  }
  return created.id;
}

async function upsertProducts(
  tenantClient: SupabaseClient,
  tenantId: string,
  items: CanonicalPayload[],
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  if (items.length === 0) return { ok: true, count: 0 };

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

  const { data, error } = await tenantClient
    .from('products')
    .upsert(rows, { onConflict: 'tenant_id,sku' })
    .select('id')
    .returns<{ id: string }[]>();

  if (error) {
    // RLS rejection (wrong role) surfaces as a 0-row/permission outcome; a real
    // DB error carries a message worth showing.
    return { ok: false, error: `Import failed: ${error.message}` };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: 'You do not have permission to import into this catalog.' };
  }
  return { ok: true, count: data.length };
}

async function finalizeRun(
  admin: SupabaseClient,
  syncRunId: string,
  status: 'completed' | 'failed',
  imported: number,
  kind: ImportableKind,
  errorLog: string[],
): Promise<void> {
  await admin
    .from('sync_runs')
    .update({
      status,
      finished_at: new Date().toISOString(),
      entities_processed: { [kind]: imported },
      error_log: errorLog,
    })
    .eq('id', syncRunId);
}
