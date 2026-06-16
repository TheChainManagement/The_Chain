import type { ReactNode } from 'react';
import { PageHeader } from '@/components/bench/PageHeader';
import pageStyles from '@/components/bench/page.module.css';
import { MetricCell } from '@/components/MetricCell/MetricCell';

/**
 * Today segment loading state (MASTER_PROMPT: every async surface gets one).
 * Mirrors the metric strip with shimmers so the layout holds while the
 * dashboard reads stream in behind the segment Suspense boundary.
 */
export default function TodayLoading(): ReactNode {
  const keys = ['AT STOCKOUT RISK', 'WORST DAYS OF SUPPLY', 'TOP SUPPLIER OTIF', 'OPEN ORDERS'];
  return (
    <div className={pageStyles.stack}>
      <PageHeader eyebrow="Your workshop, today" title="Today" />
      <div className={pageStyles.strip}>
        {keys.map((key) => (
          <MetricCell key={key} label={key} value={null} loading />
        ))}
      </div>
    </div>
  );
}
