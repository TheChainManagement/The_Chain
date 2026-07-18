import type { ReactNode } from 'react';
import { PageHeader } from '@/components/bench/PageHeader';
import pageStyles from '@/components/bench/page.module.css';
import { MetricCell } from '@/components/MetricCell/MetricCell';
import { Panel } from '@/components/Panel/Panel';

export default function PlanLoading(): ReactNode {
  return (
    <div className={pageStyles.stack}>
      <PageHeader eyebrow="One operating truth · 30-day horizon" title="Shared plan" />
      <Panel prefix="Shared number" title="30-day demand coverage" loading />
      <div className={pageStyles.strip}>
        {['Uncovered demand', 'At-risk value', 'Inventory value', 'Open PO commitment'].map(
          (label) => (
            <MetricCell key={label} label={label} value={null} loading />
          ),
        )}
      </div>
      <Panel prefix="Coverage gaps · SKU × location" title="Where the plan breaks first" loading />
    </div>
  );
}
