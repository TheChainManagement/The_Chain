import type { ReactNode } from 'react';
import pageStyles from '@/components/bench/page.module.css';
import { Panel } from '@/components/Panel/Panel';
import { StatNumber } from '@/components/StatNumber/StatNumber';
import styles from './forecast-detail.module.css';

/** Forecast detail loading state — the stats strip shimmers in place. */
export default function ForecastDetailLoading(): ReactNode {
  const keys = ['RMSSE', 'Baseline RMSSE', 'WAPE', 'Backtest windows', 'Computed'];
  return (
    <div className={pageStyles.stack}>
      <Panel prefix="Forecast" title="Loading forecast…">
        <div className={styles.stats}>
          {keys.map((key) => (
            <div key={key} className={styles.stat}>
              <span className={styles.statKey}>{key}</span>
              <StatNumber value={null} size="body" loading />
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
