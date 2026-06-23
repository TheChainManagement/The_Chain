import Link from 'next/link';
import type { ReactNode } from 'react';
import { Panel } from '@/components/Panel/Panel';
import { ReliabilityRibbon } from '@/components/ReliabilityRibbon/ReliabilityRibbon';
import { StatNumber } from '@/components/StatNumber/StatNumber';
import { otifPercent, otifTone, type SupplierDetail } from '@/lib/suppliers/transform';
import styles from './po-detail.module.css';

/**
 * The supplier's reputation, on the page where the order is approved/received
 * (FEATURES.md:451). Reuses the supplier surface's ribbon + OTIF read so the
 * operator weighs reliability without leaving the decision. A brand-new supplier
 * still shows the ribbon it will earn (pending tiles), never a blank.
 */
export function SupplierReliabilityPanel({ supplier }: { supplier: SupplierDetail }): ReactNode {
  return (
    <Panel
      prefix="Supplier"
      title={supplier.name}
      actions={
        <Link href={`/suppliers/${supplier.id}`} className={styles.supplierLink}>
          Full scorecard →
        </Link>
      }
    >
      <div className={styles.reliability}>
        <ReliabilityRibbon tiles={supplier.reliability} />
        <div className={styles.reliabilityMetrics}>
          <div className={styles.relCell}>
            <span className={styles.relKey}>OTIF (30d)</span>
            <StatNumber
              value={otifPercent(supplier.otifPct)}
              unit="%"
              tone={otifTone(supplier.otifPct)}
              size="panel"
              aria-label={supplier.otifPct == null ? 'no OTIF yet' : undefined}
            />
            <span className={styles.relSubs}>
              <span className={styles.relSub}>
                on-time {supplier.onTimePct == null ? '—' : `${otifPercent(supplier.onTimePct)}%`}
              </span>
              <span className={styles.relSub}>
                in-full {supplier.inFullPct == null ? '—' : `${otifPercent(supplier.inFullPct)}%`}
              </span>
            </span>
          </div>
          <div className={styles.relCell}>
            <span className={styles.relKey}>Lead time (actual)</span>
            <StatNumber value={supplier.leadTimeAvgDays} unit="days" size="panel" />
            <span className={styles.relSubs}>
              <span className={styles.relSub}>
                ±{supplier.leadTimeStddevDays == null ? '—' : supplier.leadTimeStddevDays} σ ·{' '}
                {supplier.scorecardSampleSize || 0} POs
              </span>
            </span>
          </div>
        </div>
      </div>
    </Panel>
  );
}
