'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServer } from '@/lib/supabase/server';

export type TransferResult =
  | { ok: true; applied: boolean; transferId: string }
  | { ok: false; error: string };

const ERROR_MAP: Record<string, string> = {
  not_authorized: 'Only an owner, manager, or warehouse operator can move stock.',
  same_location: 'Source and destination must be different locations.',
  bad_qty: 'Enter a transfer quantity greater than zero.',
  missing_idempotency_key: 'Refresh the page and try the transfer again.',
  product_not_found: 'That active SKU was not found.',
  active_location_not_found: 'Choose two active locations.',
  insufficient_transferable_stock:
    'Source stock changed and no longer has enough unheld surplus for this transfer.',
};

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
  if (!tenantId) return { ok: false, error: 'Your session expired. Sign in again.' };

  const { data, error } = await supabase.rpc('execute_stock_transfer', {
    p_tenant: tenantId,
    p_product: input.productId,
    p_source: input.sourceLocationId,
    p_destination: input.destinationLocationId,
    p_quantity: input.quantity,
    p_idempotency_key: input.idempotencyKey,
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
