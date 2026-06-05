'use server';

import { QboClient, QboSourceAdapter } from '@/lib/qbo';
import { FixtureTransport } from '@/lib/qbo/fixtures';
import {
  type CanonicalPayload,
  type Cursor,
  type EntityKind,
  FatalError,
  type PullResult,
  RetryableError,
} from '@/lib/source-adapter';
import { createSupabaseServer } from '@/lib/supabase/server';

/**
 * QBO sandbox sync (Wave 6.1).
 *
 * Runs the REAL `QboSourceAdapter` + `QboClient` + mappers against the fixture
 * transport — the same code path live OAuth drives in Wave 6.2 — and returns the
 * canonical counts the connect screen forms its chain from. It is read-only by
 * design: a preview imports nothing into the tenant, so it needs no write role
 * and no Intuit credentials, only a signed-in session.
 */

export interface QboSandboxResult {
  catalog: number;
  suppliers: number;
  ordered: number;
  inTransit: number;
  receipts: number;
  sales: number;
  errors: number;
}

export type QboSandboxOutcome =
  | { ok: true; result: QboSandboxResult }
  | { ok: false; error: string };

/** Drain a kind to exhaustion, following the adapter's resume cursor. */
async function drain(
  adapter: QboSourceAdapter,
  kind: EntityKind,
): Promise<{ items: CanonicalPayload[]; errors: number }> {
  const items: CanonicalPayload[] = [];
  let errors = 0;
  let cursor: Cursor | null = null;

  // Bounded so a misbehaving cursor can never spin forever.
  for (let page = 0; page < 1000; page++) {
    const res: PullResult = await adapter.pull(kind, cursor, `sandbox:${kind}`);
    items.push(...res.items);
    errors += res.errors.length;
    if (!res.nextCursor) break;
    cursor = res.nextCursor;
  }

  return { items, errors };
}

export async function runQboSandboxSync(): Promise<QboSandboxOutcome> {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getClaims();
  const tenantId = data?.claims?.tenant_id as string | undefined;
  if (!tenantId) {
    return { ok: false, error: 'Your session expired. Sign in again to preview a sync.' };
  }

  try {
    const client = new QboClient(
      { realmId: 'sandbox', environment: 'sandbox' },
      new FixtureTransport(),
    );
    const adapter = new QboSourceAdapter(client, tenantId);

    const products = await drain(adapter, 'product');
    const suppliers = await drain(adapter, 'supplier');
    const orders = await drain(adapter, 'purchase_order');
    const movements = await drain(adapter, 'stock_movement');

    const status = (p: CanonicalPayload) => (p.attributes as { status?: string }).status;
    const mvType = (m: CanonicalPayload) => (m.attributes as { type?: string }).type;

    return {
      ok: true,
      result: {
        catalog: products.items.length,
        suppliers: suppliers.items.length,
        ordered: orders.items.length,
        inTransit: orders.items.filter((p) => status(p) === 'sent').length,
        receipts: movements.items.filter((m) => mvType(m) === 'receipt').length,
        sales: movements.items.filter((m) => mvType(m) === 'sale').length,
        errors: products.errors + suppliers.errors + orders.errors + movements.errors,
      },
    };
  } catch (err) {
    // Preserve the adapter's taxonomy so the UI can tell rate-limit from auth
    // from a mapper fault (the live OAuth path in Wave 6.2 leans on this).
    if (err instanceof RetryableError) {
      return {
        ok: false,
        error: 'QuickBooks is rate-limiting the request. Try again in a moment.',
      };
    }
    if (err instanceof FatalError) {
      return {
        ok: false,
        error:
          err.code === 'auth'
            ? 'QuickBooks rejected the connection. Reconnect required.'
            : 'QuickBooks returned an error while reading your data.',
      };
    }
    return { ok: false, error: 'The sandbox preview could not run. Please try again.' };
  }
}
