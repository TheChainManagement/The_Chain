import type { ReactNode } from 'react';
import { PageHeader } from '@/components/bench/PageHeader';
import pageStyles from '@/components/bench/page.module.css';
import { Panel } from '@/components/Panel/Panel';
import { StatNumber } from '@/components/StatNumber/StatNumber';
import { loadForecastOverview } from '@/lib/forecast/queries';
import { createSupabaseServer } from '@/lib/supabase/server';
import { ForecastBatchControls } from './ForecastBatchControls';
import styles from './forecasts.module.css';

export const metadata = { title: 'Forecasts · The Chain' };

/**
 * Forecasts cockpit (Block 8, Wave 2b). Server shell: the latest batch run +
 * its eligibility / promotion breakdown, with the durable-batch controls. The
 * per-SKU forecast chart — the centerpiece — lands in wave 2c; this surface is
 * the batch's honest dashboard until then.
 */
export default async function ForecastsPage(): Promise<ReactNode> {
  const supabase = await createSupabaseServer();
  const overview = await loadForecastOverview(supabase);
  const { stats, latest } = overview;

  return (
    <div className={pageStyles.stack}>
      <PageHeader eyebrow="Statistical demand, not guesswork" title="Forecasts" />
      <ForecastBatchControls running={overview.running} latest={latest} />

      {stats == null ? (
        <Panel prefix="Forecasts" title="No batch has run yet">
          <p className={styles.emptyCopy}>
            Run the forecast batch to fit a statistical model to every SKU with enough sales history
            — Croston-SBA and TSB for intermittent demand, AutoETS and AutoARIMA for regular demand
            — judged against a seasonal-naive baseline. Cold SKUs fill from their category benchmark
            until they earn a model. Claude explains forecasts; it never makes them.
          </p>
        </Panel>
      ) : (
        <>
          <div className={styles.metrics}>
            <div className={styles.metric}>
              <span className={styles.metricKey}>Forecasts</span>
              <StatNumber value={stats.forecasts} size="panel" />
            </div>
            <div className={styles.metric}>
              <span className={styles.metricKey}>Promoted</span>
              <StatNumber
                value={stats.promoted}
                size="panel"
                tone={stats.promoted > 0 ? 'flow' : 'deep'}
              />
            </div>
            <div className={styles.metric}>
              <span className={styles.metricKey}>Modeled</span>
              <StatNumber value={stats.modeled} size="panel" />
            </div>
            <div className={styles.metric}>
              <span className={styles.metricKey}>Benchmark-filled</span>
              <StatNumber value={stats.benchmarked} size="panel" tone="mid" />
            </div>
            <div className={styles.metric}>
              <span className={styles.metricKey}>Failed</span>
              <StatNumber
                value={stats.failed}
                size="panel"
                tone={stats.failed > 0 ? 'stop' : 'deep'}
              />
            </div>
          </div>

          <Panel prefix="Eligibility" title="Demand history ladder">
            <p className={styles.ladderCopy}>
              A SKU earns its model with depth of history — distinct days that carry a sale, not
              elapsed time. Promotion requires beating the seasonal-naive baseline on a
              rolling-origin backtest.
            </p>
            <div className={styles.ladder}>
              <div className={styles.ladderStep}>
                <StatNumber value={stats.warm} label="WARM · 90+ sale-days" size="body" />
                <span className={styles.ladderNote}>forecasting on full history</span>
              </div>
              <div className={styles.ladderStep}>
                <StatNumber value={stats.warming} label="WARMING · 30–89" size="body" />
                <span className={styles.ladderNote}>early signal — confidence limited</span>
              </div>
              <div className={styles.ladderStep}>
                <StatNumber value={stats.cold} label="COLD · under 30" size="body" />
                <span className={styles.ladderNote}>warming up — using category benchmark</span>
              </div>
            </div>
          </Panel>

          <p className={styles.nextNote}>
            Per-SKU forecast charts — history, confidence bands, and the baseline verdict — land
            next on this page.
          </p>
        </>
      )}
    </div>
  );
}
