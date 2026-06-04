'use server';

import { revalidatePath } from 'next/cache';
import { type ImportSummary, runCsvImport } from '@/lib/import/commit';
import type { ImportableKind } from '@/lib/import/field-specs';
import type { ColumnMapping } from '@/lib/import/mapping';
import { createSupabaseServer } from '@/lib/supabase/server';

/**
 * Commit a CSV import (Block 5). Direct-callable from the preview pane.
 *
 * Verifies the caller's tenant + per-kind role from the JWT (mirrors each
 * table's RLS write gate so a viewer is rejected before any work), then hands
 * off to the commit core. The core writes master data through this same RLS
 * client; only the sync bookkeeping + default-location provisioning use the
 * service-role path.
 *
 * The role sets differ by table: products and suppliers accept
 * owner|manager|planner, but stock_movements accepts owner|manager|warehouse
 * (a planner forecasts, a warehouse role moves stock). RLS is the real net;
 * this gate just returns a clean message before doing the work.
 */

const WRITE_ROLES_BY_KIND: Record<ImportableKind, ReadonlySet<string>> = {
  product: new Set(['owner', 'manager', 'planner']),
  supplier: new Set(['owner', 'manager', 'planner']),
  stock_movement: new Set(['owner', 'manager', 'warehouse']),
};

// After a successful import, refresh the surface that reads the new rows.
const REVALIDATE_BY_KIND: Record<ImportableKind, string> = {
  product: '/inventory',
  supplier: '/suppliers',
  stock_movement: '/inventory',
};

export type ImportActionResult =
  | { ok: true; summary: ImportSummary }
  | { ok: false; error: string };

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
    // Infra provisioning (sync_run, default location, CSV connection) throws on
    // hard failure; map it to the action contract so it never blows through the
    // boundary as an unhandled rejection. The user sees a clean retry message.
    return { ok: false, error: 'Something went wrong during the import. Please try again.' };
  }
}
