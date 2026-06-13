import type { ReactNode } from 'react';
import { PageHeader } from '@/components/bench/PageHeader';
import pageStyles from '@/components/bench/page.module.css';
import { Panel } from '@/components/Panel/Panel';
import { StatNumber } from '@/components/StatNumber/StatNumber';
import { loadReorderQueue } from '@/lib/reorder/queue';
import { createSupabaseServer } from '@/lib/supabase/server';
import { RecomputeControls } from './RecomputeControls';
import { ReorderQueue } from './ReorderQueue';
import styles from './reorder.module.css';

export const metadata = { title: 'Reorder · The Chain' };

/**
 * Reorder queue (Block 11) — the product's primary action loop. Every SKU at or
 * below its reorder point surfaces here with the reasoning behind it, grouped by
 * supplier and ready to convert into a purchase order.
 */
export default async function ReorderPage(): Promise<ReactNode> {
  const supabase = await createSupabaseServer();
  const groups = await loadReorderQueue(supabase);
  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  const stockouts = groups.reduce(
    (n, g) => n + g.rows.filter((r) => r.urgency === 'stockout').length,
    0,
  );

  return (
    <div className={pageStyles.stack}>
      <PageHeader eyebrow="Reorder points you can defend" title="Reorder" />

      <div className={styles.controls}>
        <div className={styles.metrics}>
          <div className={styles.metric}>
            <span className={styles.metricKey}>To reorder</span>
            <StatNumber value={total} size="panel" />
          </div>
          <div className={styles.metric}>
            <span className={styles.metricKey}>Out of stock</span>
            <StatNumber value={stockouts} size="panel" tone={stockouts > 0 ? 'stop' : 'deep'} />
          </div>
          <div className={styles.metric}>
            <span className={styles.metricKey}>Suppliers</span>
            <StatNumber value={groups.filter((g) => g.convertible).length} size="panel" />
          </div>
        </div>
        <RecomputeControls />
      </div>

      {total === 0 ? (
        <Panel prefix="Reorder queue" title="Nothing to reorder">
          <p className={styles.empty}>
            Every SKU with a policy is at or above its reorder point. Recommendations appear here
            automatically after a forecast batch, or recompute to check the current position now.
          </p>
        </Panel>
      ) : (
        <ReorderQueue groups={groups} />
      )}
    </div>
  );
}
