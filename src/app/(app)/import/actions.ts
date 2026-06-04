'use server';

import { revalidatePath } from 'next/cache';
import { start } from 'workflow/api';
import { ensureCsvConnection, type ImportSummary, runCsvImport } from '@/lib/import/commit';
import { CsvSourceAdapter } from '@/lib/import/csv-adapter';
import type { ImportableKind } from '@/lib/import/field-specs';
import type { ColumnMapping } from '@/lib/import/mapping';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServer } from '@/lib/supabase/server';
import { importWorkflow } from '@/workflows/import';

/**
 * Commit a CSV import (Block 5). Direct-callable from the preview pane.
 *
 * Verifies the caller's tenant + per-kind role from the JWT (mirrors each
 * table's RLS write gate so a viewer is rejected before any work).
 *
 * Two execution paths, chosen by file size:
 *   - **Small files** run synchronously through the RLS commit core — instant
 *     result, writes go through the caller's RLS client (defense in depth).
 *   - **Large files** start the durable `importWorkflow` and return a tracking
 *     key the client polls. The workflow survives a crash and resumes; its
 *     writes use the service-role client, authorized here at the gate (the
 *     same trust model as the QBO/cron workflows).
 *
 * The role sets differ by table: products and suppliers accept
 * owner|manager|planner, but stock_movements accepts owner|manager|warehouse.
 */

const WRITE_ROLES_BY_KIND: Record<ImportableKind, ReadonlySet<string>> = {
  product: new Set(['owner', 'manager', 'planner']),
  supplier: new Set(['owner', 'manager', 'planner']),
  stock_movement: new Set(['owner', 'manager', 'warehouse']),
};

const REVALIDATE_BY_KIND: Record<ImportableKind, string> = {
  product: '/inventory',
  supplier: '/suppliers',
  stock_movement: '/inventory',
};

/** Above this many data rows, run durably instead of inline. */
const DURABLE_THRESHOLD = 2000;

export type ImportActionResult =
  | { ok: true; summary: ImportSummary }
  | { ok: true; async: true; trackingKey: string }
  | { ok: false; error: string };

export type ImportProgress =
  | { status: 'running'; processed: number; total: number }
  | { status: 'completed'; summary: ImportSummary }
  | { status: 'unknown' };

export async function runImport(input: {
  kind: ImportableKind;
  csvText: string;
  mapping: ColumnMapping;
  idempotencyKey: string;
}): Promise<ImportActionResult> {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getClaims();
  const tenantId = data?.claims?.tenant_id as string | undefined;
  const role = data?.claims?.tenant_role as string | undefined;

  if (!tenantId) {
    return { ok: false, error: 'Your session expired. Sign in again to import.' };
  }
  if (!role || !WRITE_ROLES_BY_KIND[input.kind].has(role)) {
    return { ok: false, error: 'You do not have permission to run this import.' };
  }

  try {
    if (estimateDataRows(input.csvText) > DURABLE_THRESHOLD) {
      return await startDurableImport({ ...input, tenantId });
    }

    const result = await runCsvImport({
      tenantClient: supabase,
      tenantId,
      kind: input.kind,
      csvText: input.csvText,
      mapping: input.mapping,
      idempotencyKey: input.idempotencyKey,
    });

    if (result.ok) {
      revalidatePath(REVALIDATE_BY_KIND[input.kind]);
    }
    return result;
  } catch {
    // Infra provisioning throws on hard failure; map it to the action contract
    // so it never escapes the boundary as an unhandled rejection.
    return { ok: false, error: 'Something went wrong during the import. Please try again.' };
  }
}

/**
 * Create the sync_run up front (so polling can find it with no race), then start
 * the durable workflow. Returns the tracking key (= sync_runs.workflow_run_id).
 */
async function startDurableImport(input: {
  kind: ImportableKind;
  csvText: string;
  mapping: ColumnMapping;
  idempotencyKey: string;
  tenantId: string;
}): Promise<ImportActionResult> {
  const admin = createSupabaseAdmin();
  const trackingKey = input.idempotencyKey;
  const capabilities = new CsvSourceAdapter({}).capabilities;
  const connectionId = await ensureCsvConnection(admin, input.tenantId, capabilities);

  const { data: runRow, error } = await admin
    .from('sync_runs')
    .insert({
      tenant_id: input.tenantId,
      connection_id: connectionId,
      workflow_run_id: trackingKey,
      status: 'running',
      started_at: new Date().toISOString(),
      cursor: { processed: 0, total: 0, kind: input.kind },
    })
    .select('id')
    .single<{ id: string }>();

  if (error || !runRow) {
    return { ok: false, error: 'Could not start the import. Please try again.' };
  }

  await start(importWorkflow, [
    {
      tenantId: input.tenantId,
      kind: input.kind,
      csvText: input.csvText,
      mapping: input.mapping,
      syncRunId: runRow.id,
    },
  ]);

  return { ok: true, async: true, trackingKey };
}

/**
 * Poll a durable import's progress by its tracking key. Reads sync_runs through
 * the RLS client (tenant-scoped), so a caller only ever sees their own runs.
 */
export async function getImportProgress(trackingKey: string): Promise<ImportProgress> {
  const supabase = await createSupabaseServer();
  const { data } = await supabase
    .from('sync_runs')
    .select('id, status, cursor')
    .eq('workflow_run_id', trackingKey)
    .maybeSingle<{
      id: string;
      status: string;
      cursor: {
        processed?: number;
        total?: number;
        done?: boolean;
        imported?: number;
        skipped?: number;
        failed?: number;
      } | null;
    }>();

  if (!data) return { status: 'unknown' };

  const c = data.cursor ?? {};
  if (data.status === 'completed') {
    const imported = c.imported ?? 0;
    const skipped = c.skipped ?? 0;
    const failed = c.failed ?? 0;
    return {
      status: 'completed',
      summary: {
        syncRunId: data.id,
        imported,
        skipped,
        failed,
        total: imported + skipped + failed,
        failures: [],
      },
    };
  }

  return { status: 'running', processed: c.processed ?? 0, total: c.total ?? 0 };
}

/** Cheap data-row estimate for the threshold (newline count minus the header). */
function estimateDataRows(csv: string): number {
  let n = 0;
  for (let i = 0; i < csv.length; i++) {
    if (csv.charCodeAt(i) === 10) n++;
  }
  return Math.max(0, n - 1);
}
