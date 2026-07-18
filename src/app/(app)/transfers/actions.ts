'use server';

import { revalidatePath } from 'next/cache';
import { memberCanAccessEveryLocation } from '@/lib/access/location-access';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServer } from '@/lib/supabase/server';

export type TransferResult =
  | { ok: true; applied: boolean; transferId: string }
  | { ok: false; error: string };

const ERROR_MAP: Record<string, string> = {
  same_location: 'Source and destination must be different locations.',
  bad_qty: 'Enter a transfer quantity greater than zero.',
  missing_idempotency_key: 'Refresh the page and try the transfer again.',
  product_not_found: 'That active SKU was not found.',
  active_location_not_found: 'Choose two active locations.',
  insufficient_transferable_stock:
    'Source stock changed and no longer has enough unheld surplus for this transfer.',
};

const OPERATOR_ROLES = new Set(['owner', 'manager', 'warehouse']);
const PERMISSION_MESSAGE = 'Only an owner, manager, or warehouse operator can move stock.';

export async function executeTransfer(input: {
  productId: string;
  sourceLocationId: string;
  destinationLocationId: string;
  quantity: number;
  idempotencyKey: string;
}): Promise<TransferResult> {
  if (!input.productId || !input.sourceLocationId || !input.destinationLocationId) {
    return { ok: false, error: 'The transfer is missing a product or location.' };
  }
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    return { ok: false, error: 'Enter a transfer quantity greater than zero.' };
  }
  const supabase = await createSupabaseServer();
  const { data: claims } = await supabase.auth.getClaims();
  const tenantId = claims?.claims?.tenant_id as string | undefined;
  const role = claims?.claims?.tenant_role as string | undefined;
  const userId = claims?.claims?.sub as string | undefined;
  if (!tenantId || !userId || !role) {
    return { ok: false, error: 'Your session expired. Sign in again.' };
  }
  if (!OPERATOR_ROLES.has(role)) return { ok: false, error: PERMISSION_MESSAGE };

  const admin = createSupabaseAdmin();
  if (
    !(await memberCanAccessEveryLocation(admin, tenantId, userId, [
      input.sourceLocationId,
      input.destinationLocationId,
    ]))
  ) {
    return { ok: false, error: 'You do not have access to both transfer locations.' };
  }

  const { data, error } = await admin.rpc('execute_stock_transfer', {
    p_tenant: tenantId,
    p_product: input.productId,
    p_source: input.sourceLocationId,
    p_destination: input.destinationLocationId,
    p_quantity: input.quantity,
    p_idempotency_key: input.idempotencyKey,
    p_actor: userId,
  });
  if (error) {
    const code = Object.keys(ERROR_MAP).find((key) => error.message.includes(key));
    return {
      ok: false,
      error: (code ? ERROR_MAP[code] : null) ?? 'Could not complete the transfer.',
    };
  }
  const row = (data as { out_applied: boolean; out_transfer_id: string }[] | null)?.[0];
  if (!row) return { ok: false, error: 'Could not complete the transfer.' };
  revalidatePath('/transfers');
  revalidatePath('/inventory');
  revalidatePath(`/inventory/${input.productId}`);
  return { ok: true, applied: row.out_applied, transferId: row.out_transfer_id };
}
