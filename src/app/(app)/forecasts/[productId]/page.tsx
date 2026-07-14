import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/bench/PageHeader';
import pageStyles from '@/components/bench/page.module.css';
import { ForecastChart } from '@/components/ForecastChart/ForecastChart';
import { ForecastInsightPanel } from '@/components/InsightPanel/ForecastInsightPanel';
import { Panel } from '@/components/Panel/Panel';
import { StatNumber } from '@/components/StatNumber/StatNumber';
import { liftCaption, loadForecastDetail } from '@/lib/forecast/detail';
import { locationHref } from '@/lib/locations/href';
import { resolveLocationScope } from '@/lib/locations/scope';
import { createSupabaseServer } from '@/lib/supabase/server';
import styles from './forecast-detail.module.css';
import { RecomputeControls } from './RecomputeControls';

export const metadata = { title: 'Forecast · The Chain' };

/**
 * Per-SKU forecast view (Block 8, Wave 2c) — the workshop's centerpiece. The
 * chart shows the weekly demand the model trained on, the forward points with
 * their widening pewter bands, the cobalt today-diamond, and the honest
 * baseline verdict underneath. Statistical numbers ride in <StatNumber>; the
 * caption never inflates (a benchmark fill says so, a losing model says so).
 */
export default async function ForecastDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ productId: string }>;
  searchParams: Promise<{ location?: string }>;
}): Promise<ReactNode> {
  const { productId } = await params;
  const supabase = await createSupabaseServer();
  const locationId = await resolveLocationScope(supabase, (await searchParams).location);
  const detail = await loadForecastDetail(supabase, productId, Date.now(), locationId);
  if (!detail) notFound();

  const { product, forecast, points, evaluation, history } = detail;
  const horizonWeeks = forecast ? Math.round(forecast.horizonDays / 7) : 0;

  return (
    <div className={pageStyles.stack}>
      <PageHeader eyebrow={`Forecasts · ${product.sku}`} title={product.name} />

      <div className={styles.meta}>
        <Link href={locationHref('/forecasts', locationId)} className={styles.backLink}>
          ← All forecasts
        </Link>
        {forecast ? (
          <div className={styles.metaTags}>
            <span className={styles.metaTag}>{forecast.methodLabel}</span>
            <span className={styles.metaTag} data-state={forecast.coldStartState}>
              {forecast.eligibilityLabel}
            </span>
            {forecast.promoted ? (
              <span className={`${styles.metaTag} ${styles.promotedTag}`}>PROMOTED</span>
            ) : null}
          </div>
        ) : null}
        <RecomputeControls productId={product.id} locationId={locationId} />
      </div>

      {forecast == null ? (
        <Panel prefix="Forecast" title="No forecast for this SKU yet">
          <p className={styles.emptyCopy}>
            Run the forecast batch from the cockpit, or recompute this SKU directly — the engine
            reads its sales history, routes a model by demand shape, and judges it against a
            seasonal-naive baseline.
          </p>
        </Panel>
      ) : (
        <>
          <Panel
            prefix="Forecast"
            title={`${product.sku} · trained history + ${horizonWeeks} weeks forward`}
          >
            {history.length === 0 && points.length === 0 ? (
              <p className={styles.emptyCopy}>
                No sales history in the trailing year and no benchmark fill yet — the chart draws
                once demand lands.
              </p>
            ) : (
              <ForecastChart
                history={history}
                points={points}
                label={`${product.sku} weekly demand history and ${horizonWeeks}-week forecast with 80% and 95% confidence bands`}
              />
            )}

            <p className={styles.caption} data-testid="lift-caption">
              {liftCaption(forecast.method, evaluation)}
            </p>

            <div className={styles.stats}>
              <div className={styles.stat}>
                <span className={styles.statKey}>RMSSE</span>
                <StatNumber value={evaluation?.rmsse?.toFixed(3) ?? null} size="body" />
              </div>
              <div className={styles.stat}>
                <span className={styles.statKey}>Baseline RMSSE</span>
                <StatNumber value={evaluation?.baselineRmsse?.toFixed(3) ?? null} size="body" />
              </div>
              <div className={styles.stat}>
                <span className={styles.statKey}>WAPE</span>
                <StatNumber
                  value={evaluation?.wape != null ? (evaluation.wape * 100).toFixed(1) : null}
                  unit="%"
                  size="body"
                />
              </div>
              <div className={styles.stat}>
                <span className={styles.statKey}>Backtest windows</span>
                <StatNumber value={evaluation?.windows ?? null} size="body" />
              </div>
              <div className={styles.stat}>
                <span className={styles.statKey}>Computed</span>
                <span className={styles.statWhen}>{fmtWhen(forecast.computedAt)}</span>
              </div>
            </div>
          </Panel>
          <ForecastInsightPanel productId={product.id} />
        </>
      )}
    </div>
  );
}

function fmtWhen(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  return new Date(t).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
