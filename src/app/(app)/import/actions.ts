'use server';

import { revalidatePath } from 'next/cache';
import { type ImportSummary, runCsvImport } from '@/lib/import/commit';
import type { ImportableKind } from '@/lib/import/field-specs';
import type { ColumnMapping } from '@/lib/import/mapping';
import { createSupabaseServer } from '@/lib/supabase/server';

/**
 * Commit a CSV import (Block 5). Direct-callable from the preview pane.
 *
 * Verifies the caller's tenant + role from the JWT (mirrors the products RLS
 * gate so a viewer is rejected before any write), then hands off to the commit
 * core. The core upserts products through this same RLS client; only the
 * sync bookkeeping uses the service-role path.
 */

const WRITE_ROLES = new Set(['owner', 'manager', 'planner']);

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
  if (!role || !WRITE_ROLES.has(role)) {
    return { ok: false, error: 'You do not have permission to import into this catalog.' };
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
    revalidatePath('/inventory');
  }
  return result;
}
