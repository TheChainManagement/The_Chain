import Link from 'next/link';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/bench/PageHeader';
import pageStyles from '@/components/bench/page.module.css';
import { Panel } from '@/components/Panel/Panel';
import { listInventory, productIdsForSupplier } from '@/lib/inventory/queries';
import { normalizeStatusFilter, sanitizeSearch } from '@/lib/inventory/transform';
import { getValuationSummary } from '@/lib/inventory/valuation';
import { loadOperatingProfile } from '@/lib/modes/resolver';
import { createSupabaseServer } from '@/lib/supabase/server';
import { listSupplierOptions } from '@/lib/suppliers/queries';
import { AddSku } from './AddSku';
import { InventoryControls } from './InventoryControls';
import { InventoryLedger } from './InventoryLedger';
import { ValuationStrip } from './ValuationStrip';

export const metadata = { title: 'Inventory · The Chain' };

/**
 * Inventory — the SKU catalog ledger (Block 3). Server Component: reads the
 * RLS-scoped catalog (filtered by ?q=&status=&supplier=) from the aggregate view
 * and hands rows to the selectable ledger. The supplier filter narrows to SKUs a
 * supplier sources (product_suppliers); the bench scales to 5k via the view.
 */
export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; supplier?: string }>;
}): Promise<ReactNode> {
  const sp = await searchParams;
  const search = sp.q ?? '';
  const status = normalizeStatusFilter(sp.status);
  const supplierId = sp.supplier ?? '';
  const filtering = Boolean(sanitizeSearch(search)) || status !== 'active' || Boolean(supplierId);

  const supabase = await createSupabaseServer();
  const supplierOptions = await listSupplierOptions(supabase);

  // W2-2: the operator surface follows the mode spine — issue-archetype
  // tenants (storeroom, food) get the issue-out affordance on this ledger.
  const { data: claims } = await supabase.auth.getClaims();
  const tenantId = claims?.claims?.tenant_id as string | undefined;
  const profile = tenantId ? await loadOperatingProfile(tenantId) : null;
  const showIssue = profile?.archetype === 'issue';

  // Supplier filter resolves to a product-id set the list query intersects with.
  const productIds = supplierId ? await productIdsForSupplier(supabase, supplierId) : null;
  const [rows, valuation] = await Promise.all([
    listInventory(supabase, { search, status, productIds }),
    getValuationSummary(supabase),
  ]);

  return (
    <div className={pageStyles.stack}>
      <PageHeader
        eyebrow="Catalog · on-hand by SKU"
        title={profile?.navLabels['/inventory'] ?? 'Inventory'}
        actions={
          <div className={pageStyles.headerActions}>
            <Link href="/inventory/cycle-counts" className={pageStyles.headerLink}>
              Cycle counts
            </Link>
            <Link href="/inventory/classification" className={pageStyles.headerLink}>
              Classification
            </Link>
            <AddSku />
          </div>
        }
      />

      {valuation && (valuation.totalValue != null || valuation.uncostedSkus > 0) ? (
        <ValuationStrip summary={valuation} />
      ) : null}

      <InventoryControls
        search={search}
        status={status}
        supplierId={supplierId}
        supplierOptions={supplierOptions}
      />

      {rows.length === 0 ? (
        <Panel
          prefix="Catalog"
          title={filtering ? 'No SKUs match' : 'No SKUs on the bench yet'}
          empty
          emptyMessage={
            filtering
              ? 'Nothing matches that search or filter. Clear it to see the whole catalog.'
              : 'Add your first SKU, or connect a source to import your whole catalog at once.'
          }
        />
      ) : (
        <InventoryLedger rows={rows} showIssue={showIssue} />
      )}
    </div>
  );
}
