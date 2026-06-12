import type { ReactNode } from 'react';
import { PageHeader } from '@/components/bench/PageHeader';
import pageStyles from '@/components/bench/page.module.css';
import { StatNumber } from '@/components/StatNumber/StatNumber';
import styles from './forecasts.module.css';

/**
 * Forecasts segment loading state (MASTER_PROMPT: every async surface gets a
 * loading state). Mirrors the cockpit's metric strip with StatNumber shimmers
 * so the layout doesn't jump when the data streams in.
 */
export default function ForecastsLoading(): ReactNode {
  const keys = ['Forecasts', 'Promoted', 'Modeled', 'Benchmark-filled', 'Failed'];
  return (
    <div className={pageStyles.stack}>
      <PageHeader eyebrow="Statistical demand, not guesswork" title="Forecasts" />
      <div className={styles.metrics}>
        {keys.map((key) => (
          <div key={key} className={styles.metric}>
            <span className={styles.metricKey}>{key}</span>
            <StatNumber value={null} size="panel" loading />
          </div>
        ))}
      </div>
    </div>
  );
}
