import Link from 'next/link';
import type { ReactNode } from 'react';
import pageStyles from '@/components/bench/page.module.css';
import { MetricCell } from '@/components/MetricCell/MetricCell';
import { Panel } from '@/components/Panel/Panel';
import { type MemberRole, ROLE_PROFILES } from '@/lib/access';
import type { TodayFocusFact } from '@/lib/dashboard/role-focus';
import styles from './today.module.css';

export function RoleTodayPanel({
  role,
  facts,
  planHref = '/plan',
}: {
  role: MemberRole;
  facts: TodayFocusFact[];
  planHref?: string;
}): ReactNode {
  return (
    <Panel prefix={`${ROLE_PROFILES[role].label} bench`} title={focusTitle(role)}>
      <div className={styles.focusGrid}>
        {facts.map((fact) => (
          <Link key={fact.label} href={fact.href} className={styles.focusFact}>
            <MetricCell label={fact.label} value={fact.value} unit={fact.unit} tone={fact.tone} />
          </Link>
        ))}
      </div>
      <Link href={planHref} className={pageStyles.headerLink}>
        Open the shared 30-day plan →
      </Link>
    </Panel>
  );
}

function focusTitle(role: MemberRole): string {
  switch (ROLE_PROFILES[role].todayFocus) {
    case 'network':
      return 'Network exceptions and decisions';
    case 'planning':
      return 'Demand and replenishment queue';
    case 'warehouse':
      return 'Physical work by authorized location';
    case 'finance':
      return 'Value, commitments, and exposure';
    case 'overview':
      return 'Read-only network health';
  }
}
