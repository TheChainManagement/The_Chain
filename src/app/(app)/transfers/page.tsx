import type { ReactNode } from 'react';
import { PageHeader } from '@/components/bench/PageHeader';
import pageStyles from '@/components/bench/page.module.css';
import { Panel } from '@/components/Panel/Panel';
import { StatNumber } from '@/components/StatNumber/StatNumber';
import { resolveLocationScope } from '@/lib/locations/scope';
import { createSupabaseServer } from '@/lib/supabase/server';
import { loadTransferRecommendations } from '@/lib/transfers/recommend';
import { TransferAction } from './TransferAction';
import styles from './transfers.module.css';

export const metadata = { title: 'Transfers · The Chain' };

export default async function TransfersPage({
  searchParams,
}: {
  searchParams: Promise<{ location?: string }>;
}): Promise<ReactNode> {
  const supabase = await createSupabaseServer();
  const locationId = await resolveLocationScope(supabase, (await searchParams).location);
  const all = await loadTransferRecommendations(supabase);
  const recommendations = locationId
    ? all.filter(
        (row) => row.sourceLocationId === locationId || row.destinationLocationId === locationId,
      )
    : all;

  return (
    <div className={pageStyles.stack}>
      <PageHeader eyebrow="Network · rebalance without buying" title="Transfers" />
      {recommendations.length === 0 ? (
        <Panel
          prefix="Transfer tray"
          title="No safe transfers recommended"
          empty
          emptyMessage="A recommendation appears when one location is below its reorder point and another has unheld, unallocated stock above safety."
        />
      ) : (
        <div className={styles.grid}>
          {recommendations.map((recommendation) => (
            <article
              key={`${recommendation.productId}:${recommendation.sourceLocationId}:${recommendation.destinationLocationId}`}
              className={styles.card}
            >
              <header>
                <span className={styles.sku}>{recommendation.sku}</span>
                <strong>{recommendation.name}</strong>
              </header>
              <div className={styles.flow}>
                <div>
                  <span>Source surplus</span>
                  <strong>{recommendation.sourceLocationName}</strong>
                  <StatNumber value={recommendation.sourceSurplus} />
                </div>
                <span className={styles.link}>OUT → IN</span>
                <div>
                  <span>Destination need</span>
                  <strong>{recommendation.destinationLocationName}</strong>
                  <StatNumber value={recommendation.destinationNeed} />
                </div>
              </div>
              <TransferAction recommendation={recommendation} />
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
