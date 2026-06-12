import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/bench/PageHeader';
import pageStyles from '@/components/bench/page.module.css';
import { ChainLink, type ChainState } from '@/components/ChainLink/ChainLink';
import { ClassificationBadge } from '@/components/ClassificationBadge/ClassificationBadge';
import { Panel } from '@/components/Panel/Panel';
import { StatNumber, type StatTone } from '@/components/StatNumber/StatNumber';
import {
  getProductDetail,
  type ProductDetail,
  type ProductLocationPosition,
} from '@/lib/inventory/queries';
import { dosTone, loadProductPolicies, type ProductPolicy, riskTone } from '@/lib/policy/queries';
import { createSupabaseServer } from '@/lib/supabase/server';
import { listSupplierOptions } from '@/lib/suppliers/queries';
import styles from './detail.module.css';
import { SkuActions } from './SkuActions';
import { SupplierLinks } from './SupplierLinks';

export const metadata = { title: 'SKU · The Chain' };

/**
 * SKU detail — one product's bench. The memorable element is the LIFETIME CHAIN
 * at the top: the same PO-chain motif scaled down, telling this SKU's story
 * (added → forecasted → reordered → received) at a glance. Links the SKU has
 * reached read as resolved; the live edge ignites cobalt; the rest wait.
 */
export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}): Promise<ReactNode> {
  const { productId } = await params;
  const supabase = await createSupabaseServer();
  const product = await getProductDetail(supabase, productId);

  // RLS returns nothing for a cross-tenant id → 404, never a leak.
  if (!product) {
    notFound();
  }

  // Active suppliers for the link picker + the SKU's replenishment policy
  // (Block 9), both RLS-scoped to the tenant.
  const [supplierOptions, policies] = await Promise.all([
    listSupplierOptions(supabase),
    loadProductPolicies(supabase, productId),
  ]);

  return (
    <div className={pageStyles.stack}>
      <Link href="/inventory" className={styles.back}>
        ← Inventory
      </Link>

      <PageHeader
        eyebrow={`SKU · ${product.sku}`}
        title={product.name}
        actions={
          <SkuActions
            productId={product.id}
            name={product.name}
            unitOfMeasure={product.unitOfMeasure}
            description={product.description}
            status={product.status}
          />
        }
      />

      <LifetimeChain product={product} />

      <div className={styles.layout}>
        <PositionPanel product={product} />
        <PolicyPanel policies={policies} productId={product.id} />
        <SupplierLinks
          productId={product.id}
          suppliers={product.suppliers}
          options={supplierOptions}
        />
        <ClassificationPanel product={product} />
        <IdentityPanel product={product} />
      </div>
    </div>
  );
}

/* ----- Memorable: the SKU lifetime chain ----- */

function LifetimeChain({ product }: { product: ProductDetail }): ReactNode {
  const stocked = product.firstStockedAt ?? null;
  // Each stage's state: the furthest reached stage is the live (ignited) link.
  // Pre-ingestion SKUs have reached only "Added"; that link is the live edge.
  const reachedStocked = Boolean(stocked);
  const forecast = product.latestForecast;
  const reachedForecast = Boolean(forecast);

  const stages: {
    step: string;
    label: string;
    when?: string;
    state: ChainState;
    connector: 'cobalt' | 'pewter' | 'none';
  }[] = [
    {
      step: 'ADDED',
      label: 'On the bench',
      when: fmtWhen(product.createdAt),
      state: reachedStocked || reachedForecast ? 'done' : 'active',
      connector: 'pewter',
    },
    {
      step: 'STOCKED',
      label: reachedStocked ? 'First receipt' : 'No receipts yet',
      when: stocked ? fmtWhen(stocked) : undefined,
      state: reachedStocked ? (reachedForecast ? 'done' : 'active') : 'pending',
      connector: 'pewter',
    },
    {
      step: 'FORECASTED',
      label: reachedForecast
        ? forecast?.promoted
          ? 'Model promoted'
          : 'Forecast live'
        : 'Awaiting forecast',
      when: forecast ? fmtWhen(forecast.computedAt) : undefined,
      state: reachedForecast ? 'active' : 'pending',
      connector: 'pewter',
    },
    {
      step: 'REORDERED',
      label: 'Not yet',
      state: 'pending',
      connector: 'none',
    },
  ];

  return (
    <section className={styles.lifetime} aria-label="SKU lifetime">
      <span className={styles.lifetimeEyebrow}>Lifetime</span>
      <div className={styles.lifetimeChain}>
        {stages.map((s) => (
          <ChainLink
            key={s.step}
            step={s.step}
            label={s.label}
            when={s.when}
            state={s.state}
            connector={s.connector}
          />
        ))}
      </div>
    </section>
  );
}

/* ----- Replenishment policy: DOS + stockout risk (Block 9) ----- */

function PolicyPanel({
  policies,
  productId,
}: {
  policies: ProductPolicy[];
  productId: string;
}): ReactNode {
  if (policies.length === 0) {
    return (
      <Panel
        prefix="Policy"
        title="Replenishment policy"
        empty
        emptyMessage="No policy yet — it derives from a promoted forecast and the primary supplier's lead time."
      />
    );
  }

  return (
    <Panel
      prefix="Policy"
      title="Replenishment policy"
      actions={
        <Link href={`/inventory/policy?product=${productId}`} className={styles.policyBenchLink}>
          What-if bench →
        </Link>
      }
    >
      {policies.map((p) => (
        <div key={p.locationId} className={styles.policyBlock}>
          <div className={styles.policyWidgets}>
            <div className={styles.policyWidget}>
              <StatNumber
                value={p.daysOfSupply != null ? p.daysOfSupply.toFixed(1) : null}
                unit="days"
                size="hero"
                tone={dosTone(p.daysOfSupply, p.leadTimeDaysUsed)}
                label="DAYS OF SUPPLY"
                aria-label={p.daysOfSupply == null ? 'no on-hand data yet' : undefined}
              />
              <span className={styles.policyContext}>
                {p.daysOfSupply == null
                  ? 'No on-hand data yet'
                  : p.holdsThrough
                    ? `Forecast holds through ${fmtDate(p.holdsThrough)}`
                    : `Lead time ${fmtQty(p.leadTimeDaysUsed)} days`}
              </span>
            </div>
            <div className={styles.policyWidget}>
              <StatNumber
                value={p.stockoutRisk != null ? (p.stockoutRisk * 100).toFixed(1) : null}
                unit="%"
                size="hero"
                tone={riskTone(p.stockoutRisk)}
                label="STOCKOUT RISK"
                aria-label={p.stockoutRisk == null ? 'no position to assess' : undefined}
              />
              <span className={styles.policyContext}>Next cycle ending below safety stock</span>
            </div>
          </div>

          <div className={styles.policyNumbers}>
            <span className={styles.policyNumber}>
              <span className={styles.policyKey}>Reorder point</span>
              <StatNumber value={fmtMaybe(p.reorderPoint)} />
            </span>
            <span className={styles.policyNumber}>
              <span className={styles.policyKey}>Safety stock</span>
              <StatNumber value={fmtMaybe(p.safetyStock)} />
            </span>
            <span className={styles.policyNumber}>
              <span className={styles.policyKey}>Recommended qty</span>
              <StatNumber value={fmtMaybe(p.recommendedOrderQty)} />
            </span>
            <span className={styles.policyNumber}>
              <span className={styles.policyKey}>Lead time</span>
              <StatNumber value={fmtQty(p.leadTimeDaysUsed)} unit="days" />
              <span className={styles.policySource}>
                {p.leadTimeSource === 'scorecard' ? 'empirical · scorecard' : 'supplier setting'}
              </span>
            </span>
            <span className={styles.policyNumber}>
              <span className={styles.policyKey}>Service level</span>
              <StatNumber value={(p.serviceLevel * 100).toFixed(1)} unit="%" />
            </span>
          </div>

          {policies.length > 1 ? (
            <span className={styles.policyLocation}>{p.locationName}</span>
          ) : null}
        </div>
      ))}
    </Panel>
  );
}

function fmtMaybe(v: number | null): string | null {
  return v == null ? null : fmtQty(v);
}

function fmtDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/* ----- Current position by location ----- */

function PositionPanel({ product }: { product: ProductDetail }): ReactNode {
  const { positions, totals } = product;
  if (positions.length === 0) {
    return (
      <Panel
        prefix="Position"
        title="Current position"
        empty
        emptyMessage="No stock recorded yet. On-hand by location lands when a source syncs or a count is posted."
      />
    );
  }

  return (
    <Panel prefix="Position" title="Current position">
      <div className={styles.posTable}>
        <div className={styles.posHead} aria-hidden="true">
          <span>Location</span>
          <span className={styles.posNumHead}>On hand</span>
          <span className={styles.posNumHead}>Allocated</span>
          <span className={styles.posNumHead}>Available</span>
        </div>
        {positions.map((p) => (
          <PositionRow key={p.locationId} pos={p} />
        ))}
        <div className={`${styles.posRow} ${styles.posTotal}`}>
          <span className={styles.posLoc}>All locations</span>
          <span className={styles.posNum}>
            <StatNumber value={fmtQty(totals.onHand)} />
          </span>
          <span className={styles.posNum}>
            <StatNumber value={fmtQty(totals.allocated)} />
          </span>
          <span className={styles.posNum}>
            <StatNumber value={fmtQty(totals.available)} tone={availableTone(totals.available)} />
          </span>
        </div>
      </div>
    </Panel>
  );
}

function PositionRow({ pos }: { pos: ProductLocationPosition }): ReactNode {
  return (
    <div className={styles.posRow}>
      <span className={styles.posLoc}>
        {pos.locationName ?? 'Unnamed location'}
        {pos.locationType ? <span className={styles.posType}>{pos.locationType}</span> : null}
      </span>
      <span className={styles.posNum}>
        <StatNumber value={fmtQty(pos.onHand)} />
      </span>
      <span className={styles.posNum}>
        <StatNumber value={fmtQty(pos.allocated)} />
      </span>
      <span className={styles.posNum}>
        <StatNumber value={fmtQty(pos.available)} tone={availableTone(pos.available)} />
      </span>
    </div>
  );
}

/* ----- Classification ----- */

function ClassificationPanel({ product }: { product: ProductDetail }): ReactNode {
  const c = product.classification;
  if (!c || (!c.abcClass && !c.xyzClass)) {
    return (
      <Panel
        prefix="Classification"
        title="ABC · XYZ"
        empty
        emptyMessage="Not yet classified. ABC/XYZ is assigned once 12 months of demand is available."
      />
    );
  }

  return (
    <Panel prefix="Classification" title="ABC · XYZ">
      <div className={styles.classGrid}>
        <div className={styles.classCell}>
          <span className={styles.classKey}>Class</span>
          <ClassificationBadge abc={c.abcClass} xyz={c.xyzClass} size="md" />
        </div>
        <div className={styles.classConsumption}>
          <span className={styles.classKey}>Annual consumption value</span>
          <StatNumber
            value={c.annualConsumptionValue == null ? null : fmtMoney(c.annualConsumptionValue)}
            unit="$"
            unitPosition="prefix"
            size="panel"
          />
        </div>
      </div>
    </Panel>
  );
}

/* ----- Identity ----- */

function IdentityPanel({ product }: { product: ProductDetail }): ReactNode {
  const attrs = Object.entries(product.attributes ?? {});
  return (
    <Panel prefix="Identity" title="Details">
      <dl className={styles.idList}>
        <IdentityRow label="SKU" value={product.sku} mono />
        <IdentityRow label="Unit of measure" value={product.unitOfMeasure ?? '—'} />
        <IdentityRow label="Description" value={product.description ?? '—'} />
        {attrs.map(([k, v]) => (
          <IdentityRow key={k} label={k} value={String(v)} />
        ))}
      </dl>
    </Panel>
  );
}

function IdentityRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): ReactNode {
  return (
    <div className={styles.idRow}>
      <dt className={styles.idKey}>{label}</dt>
      <dd className={`${styles.idValue} ${mono ? styles.idValueMono : ''}`}>{value}</dd>
    </div>
  );
}

/* ----- format helpers ----- */

const fmtQty = (n: number): string => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
const fmtMoney = (n: number): string =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const WHEN_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
function fmtWhen(iso: string): string {
  const parts = WHEN_FMT.formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('month')} ${get('day')} · ${get('hour')}:${get('minute')}`;
}

function availableTone(available: number): StatTone {
  if (available <= 0) {
    return 'stop';
  }
  return 'deep';
}
