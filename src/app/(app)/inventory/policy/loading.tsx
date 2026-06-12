import type { ReactNode } from 'react';
import { PageHeader } from '@/components/bench/PageHeader';
import pageStyles from '@/components/bench/page.module.css';
import { Panel } from '@/components/Panel/Panel';
import { StatNumber } from '@/components/StatNumber/StatNumber';
import styles from './policy.module.css';

/** Policy bench loading state — the ribbon shimmers in place. */
export default function PolicyBenchLoading(): ReactNode {
  const keys = [
    'Days of supply',
    'Reorder point',
    'Safety stock',
    'Recommended qty',
    'Stockout risk',
  ];
  return (
    <div className={pageStyles.stack}>
      <PageHeader eyebrow="Inventory · what-if" title="Policy bench" />
      <Panel prefix="What-if" title="Loading the bench…">
        <div className={styles.ribbon}>
          {keys.map((key) => (
            <div key={key} className={styles.ribbonCell}>
              <span className={styles.ribbonKey}>{key}</span>
              <StatNumber value={null} size="panel" loading />
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
