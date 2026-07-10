import Link from 'next/link';
import type { ReactNode } from 'react';
import pageStyles from '@/components/bench/page.module.css';
import { MetricCell } from '@/components/MetricCell/MetricCell';
import type { ValuationSummary } from '@/lib/inventory/valuation';
import styles from './valuation.module.css';

/**
 * ValuationStrip (W2-2.5) — the "what is my inventory worth" answer, priced at
 * the moving-average cost the posting kernel maintains. Border-divided metric
 * strip (never cards): total value INCLUDES held stock (MG 2026-07-09), held
 * value is broken out beside it, and NO COST YET counts stocked SKUs whose
 * worth is unknown — surfaced, not silently dropped from the total.
 */
export function ValuationStrip({ summary }: { summary: ValuationSummary }): ReactNode {
  const uncosted = summary.uncostedSkus;
  return (
    <div className={styles.valuationWrap}>
      <div className={pageStyles.strip}>
        <MetricCell
          label="INVENTORY VALUE"
          value={summary.totalValue == null ? null : fmtMoney(summary.totalValue)}
          unit="$"
          unitPosition="prefix"
        />
        <MetricCell
          label="HELD VALUE"
          value={summary.heldValue == null ? null : fmtMoney(summary.heldValue)}
          unit="$"
          unitPosition="prefix"
          tone={(summary.heldValue ?? 0) > 0 ? 'warn' : 'deep'}
        />
        <MetricCell
          label="NO COST YET"
          value={uncosted}
          unit="SKUs"
          tone={uncosted > 0 ? 'warn' : 'deep'}
        />
      </div>
      <Link
        href="/api/exports/inventory/valuation"
        prefetch={false}
        className={pageStyles.headerLink}
      >
        Export valuation CSV ↓
      </Link>
    </div>
  );
}

const fmtMoney = (n: number): string =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
