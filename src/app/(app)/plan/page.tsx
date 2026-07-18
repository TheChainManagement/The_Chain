import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/bench/PageHeader';
import pageStyles from '@/components/bench/page.module.css';
import { MetricCell } from '@/components/MetricCell/MetricCell';
import { Panel } from '@/components/Panel/Panel';
import { StatNumber } from '@/components/StatNumber/StatNumber';
import { isMemberRole, type MemberRole, ROLE_PROFILES, roleCan } from '@/lib/access';
import { locationHref } from '@/lib/locations/href';
import { resolveLocationScope } from '@/lib/locations/scope';
import { loadPlanSnapshot } from '@/lib/plan/queries';
import { createSupabaseServer } from '@/lib/supabase/server';
import styles from './plan.module.css';

export const metadata = { title: 'Shared plan · The Chain' };

const units = (value: number): string =>
  value.toLocaleString('en-US', { maximumFractionDigits: 1 });
const money = (value: number): string =>
  value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function roleLens(role: MemberRole, locationId: string | null): { label: string; href: string } {
  if (roleCan(role, 'planning.manage')) {
    return { label: 'Work the coverage gaps', href: locationHref('/reorder', locationId) };
  }
  if (roleCan(role, 'inventory.execute')) {
    return { label: 'Open physical inventory', href: locationHref('/inventory', locationId) };
  }
  if (roleCan(role, 'valuation.view')) {
    return { label: 'Review inventory value', href: locationHref('/inventory', locationId) };
  }
  return { label: 'Inspect inventory health', href: locationHref('/inventory', locationId) };
}

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ location?: string }>;
}): Promise<ReactNode> {
  const supabase = await createSupabaseServer();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.tenant_id) redirect('/signin');
  const locationId = await resolveLocationScope(supabase, (await searchParams).location);
  const capturedAt = new Date().toISOString();
  const snapshot = await loadPlanSnapshot(supabase, { capturedAt, locationId });
  const roleClaim = claimsData?.claims?.tenant_role;
  const role: MemberRole = isMemberRole(roleClaim) ? roleClaim : 'viewer';
  const lens = roleLens(role, locationId);
  const capturedLabel = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(snapshot.capturedAt));

  return (
    <div className={pageStyles.stack}>
      <PageHeader eyebrow="One operating truth · 30-day horizon" title="Shared plan" />

      <div className={styles.snapshotBar}>
        <span>LIVE SNAPSHOT · {capturedLabel} UTC</span>
        <span>
          {snapshot.activeSkuCount} active SKUs · {snapshot.authorizedLocationCount} authorized
          {snapshot.authorizedLocationCount === 1 ? ' location' : ' locations'}
        </span>
      </div>

      <div className={styles.coverageGrid}>
        <Panel prefix="Shared number" title="30-day demand coverage" focused>
          <div className={styles.coverageHero}>
            <StatNumber
              value={snapshot.coveragePct === null ? 'NO DEMAND' : snapshot.coveragePct.toFixed(1)}
              unit={snapshot.coveragePct === null ? undefined : '%'}
              size={snapshot.coveragePct === null ? 'panel' : 'hero'}
              tone={
                snapshot.coveragePct === null
                  ? 'deep'
                  : snapshot.coveragePct >= 90
                    ? 'flow'
                    : snapshot.coveragePct >= 75
                      ? 'warn'
                      : 'stop'
              }
              aria-label={snapshot.coveragePct === null ? 'No planned demand' : undefined}
            />
            <div className={styles.coverageCopy}>
              <strong>
                {snapshot.coveragePct === null
                  ? 'No planned demand'
                  : `${units(snapshot.coveredDemandUnits)} of ${units(snapshot.forecastDemandUnits)} forecast units covered`}
              </strong>
              <span>
                Physical available stock plus confirmed incoming due before {snapshot.horizonEndsAt}
                . Held and allocated units do not count.
              </span>
            </div>
          </div>
        </Panel>

        <Panel prefix={`${ROLE_PROFILES[role].label} lens`} title="Your next read">
          <div className={styles.lens}>
            <p>{ROLE_PROFILES[role].description}</p>
            <Link href={lens.href} className={pageStyles.headerLink}>
              {lens.label} →
            </Link>
          </div>
        </Panel>
      </div>

      <div className={`${pageStyles.strip} ${styles.metricStrip}`}>
        <MetricCell
          label="UNCOVERED DEMAND"
          value={units(snapshot.uncoveredDemandUnits)}
          unit="units"
          tone={snapshot.uncoveredDemandUnits > 0 ? 'stop' : 'flow'}
        />
        <MetricCell
          label="AT-RISK VALUE"
          value={money(snapshot.uncoveredDemandValue)}
          unit="$"
          unitPosition="prefix"
          tone={snapshot.uncoveredDemandValue > 0 ? 'warn' : 'deep'}
        />
        <MetricCell
          label="INVENTORY VALUE"
          value={money(snapshot.inventoryValue)}
          unit="$"
          unitPosition="prefix"
        />
        <MetricCell
          label="OPEN PO COMMITMENT"
          value={money(snapshot.openPoCommitment)}
          unit="$"
          unitPosition="prefix"
        />
      </div>

      <div className={styles.bodyGrid}>
        <Panel
          prefix="Coverage gaps · SKU × location"
          title="Where the plan breaks first"
          empty={snapshot.topGaps.length === 0}
          emptyMessage={
            snapshot.coveragePct === null
              ? 'No usable planned demand is inside this horizon yet.'
              : 'Available and confirmed incoming supply cover the current 30-day demand plan.'
          }
        >
          <div className={styles.tableWrap}>
            <table className={styles.gapTable}>
              <thead>
                <tr>
                  <th>SKU / location</th>
                  <th>Demand</th>
                  <th>Available</th>
                  <th>Incoming</th>
                  <th>Gap</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.topGaps.map((gap) => (
                  <tr key={`${gap.productId}:${gap.locationId}`}>
                    <td>
                      <Link href={locationHref(`/inventory/${gap.productId}`, gap.locationId)}>
                        <strong>{gap.sku}</strong>
                        <span>{gap.locationName}</span>
                      </Link>
                    </td>
                    <td>{units(gap.demandUnits)}</td>
                    <td>{units(gap.availableUnits)}</td>
                    <td>{units(gap.incomingUnits)}</td>
                    <td className={styles.gap}>{units(gap.uncoveredUnits)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <aside className={styles.rail} aria-label="Plan trust notes">
          <Panel prefix="Demand quality" title="What is excluded">
            <div className={styles.quality}>
              <StatNumber
                value={snapshot.dataQualityCount}
                unit="SKU-locations"
                size="panel"
                tone={snapshot.dataQualityCount > 0 ? 'warn' : 'flow'}
              />
              <p>
                Missing or unusable forecasts are excluded from the percentage, never treated as
                zero demand.
              </p>
              {snapshot.dataQualityCount > 0 && roleCan(role, 'planning.manage') ? (
                <Link
                  href={locationHref('/forecasts', locationId)}
                  className={pageStyles.headerLink}
                >
                  Repair forecast coverage →
                </Link>
              ) : null}
            </div>
          </Panel>
          <Panel prefix="Supply basis" title="Committed inside 30 days">
            <dl className={styles.definitionList}>
              <div>
                <dt>Confirmed incoming</dt>
                <dd>{units(snapshot.confirmedIncomingUnits)} units</dd>
              </div>
              <div>
                <dt>Committed POs</dt>
                <dd>{snapshot.committedPoCount}</dd>
              </div>
              <div>
                <dt>Unvalued gap</dt>
                <dd>{units(snapshot.unvaluedGapUnits)} units</dd>
              </div>
            </dl>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
