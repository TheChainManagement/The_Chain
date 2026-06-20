import { type NextRequest, NextResponse } from 'next/server';
import { collectAuditCsvRows, getRetentionTier } from '@/lib/audit/queries';
import {
  canReadAudit,
  resolvePeriod,
  tierWindowCutoffIso,
  toAuditCsv,
} from '@/lib/audit/transform';
import { createSupabaseServer } from '@/lib/supabase/server';

/**
 * Audit-log CSV export (Block 14a). `/api/exports/audit/<period>.csv`, where
 * period is `window` (the whole tier hot window), `YYYY`, or `YYYY-MM`.
 *
 * The role gate is EXPLICIT here, not just RLS: a viewer/planner would otherwise
 * get an empty 200 because RLS hides every row. The acceptance bar is a 403, so
 * we check the JWT role and refuse before touching data. The window is clamped
 * to the tier so the export can never reach past the cutoff (RLS-scoped reads
 * plus the clamp = defence in depth).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ file: string }> },
): Promise<NextResponse> {
  const { file } = await params;
  const period = file.replace(/\.csv$/i, '');

  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse('Unauthorized', { status: 401 });

  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  const tenantId = claims?.tenant_id as string | undefined;
  const role = claims?.tenant_role as string | undefined;
  if (!tenantId) return new NextResponse('Unauthorized', { status: 401 });
  if (!canReadAudit(role)) {
    return new NextResponse('The audit log is restricted to owners, managers, and finance.', {
      status: 403,
    });
  }

  const nowMs = Date.now();
  const tier = await getRetentionTier(tenantId);
  const cutoffIso = tierWindowCutoffIso(tier, nowMs);
  const range = resolvePeriod(period, cutoffIso, nowMs);
  if (!range) {
    return new NextResponse('Unrecognized period. Use window, YYYY, or YYYY-MM.', { status: 400 });
  }

  // RLS-scoped: only this tenant's rows resolve. Paginated so the download is the
  // WHOLE window, not a silently-truncated first page.
  const { rows, truncated } = await collectAuditCsvRows(supabase, range);
  const csv = toAuditCsv(rows);
  const slug = period.replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '') || 'window';

  const headers: Record<string, string> = {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="audit-${slug}.csv"`,
    'Cache-Control': 'no-store',
    'X-Audit-Row-Count': String(rows.length),
  };
  // Honest signal if the export hit the safety ceiling (never silent truncation).
  if (truncated) headers['X-Audit-Export-Truncated'] = 'true';

  return new NextResponse(csv, { status: 200, headers });
}
