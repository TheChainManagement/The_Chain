import { notFound } from 'next/navigation';
import { ConflictCockpit } from '@/app/(app)/flow/sync-conflicts/ConflictCockpit';
import conflictStyles from '@/app/(app)/flow/sync-conflicts/sync-conflicts.module.css';
import { QuadrantGrid } from '@/app/(app)/inventory/classification/QuadrantGrid';
import { ActionButton } from '@/components/ActionButton/ActionButton';
import { ChainLink } from '@/components/ChainLink/ChainLink';
import { ClassificationBadge } from '@/components/ClassificationBadge/ClassificationBadge';
import { ClaudeInsight } from '@/components/ClaudeInsight/ClaudeInsight';
import { MetricCell } from '@/components/MetricCell/MetricCell';
import { Panel } from '@/components/Panel/Panel';
import { StatNumber } from '@/components/StatNumber/StatNumber';
import type { Quadrant } from '@/lib/classification/queries';
import type { PendingConflict } from '@/lib/qbo/conflicts';
import styles from './gallery.module.css';

// Fixture ABC/XYZ quadrant for the Block 7 showcase. Real-feeling SKUs, organic
// values (MASTER_PROMPT: never Acme / round demo numbers).
const tile = (sku: string, name: string, value: number, adi: number, cv2: number) => ({
  productId: sku,
  sku,
  name,
  value,
  adi,
  cv2,
});
const GALLERY_QUADRANT: Quadrant = {
  computedAt: '2026-06-10T19:40:00.000Z',
  classified: 9,
  cells: [
    {
      abc: 'A',
      xyz: 'X',
      count: 2,
      totalValue: 48210.5,
      items: [
        tile('RBH-4471', 'Riverbend Hose Bibb', 31200, 1.04, 0.12),
        tile('CPR-2210', 'Copper Pipe 3/4', 17010.5, 1.1, 0.21),
      ],
    },
    {
      abc: 'A',
      xyz: 'Y',
      count: 1,
      totalValue: 22640,
      items: [tile('SPH-0190', 'Sprinkler Head Rotor', 22640, 1.8, 0.74)],
    },
    {
      abc: 'A',
      xyz: 'Z',
      count: 1,
      totalValue: 19880.25,
      items: [tile('PMP-5520', 'Booster Pump 1HP', 19880.25, 4.2, 1.63)],
    },
    {
      abc: 'B',
      xyz: 'X',
      count: 1,
      totalValue: 8120,
      items: [tile('GHN-2x10', 'Galvanized Joist Hanger', 8120, 1.2, 0.18)],
    },
    {
      abc: 'B',
      xyz: 'Y',
      count: 1,
      totalValue: 5440.75,
      items: [tile('VLV-0312', 'Gate Valve 2in', 5440.75, 2.1, 0.66)],
    },
    {
      abc: 'B',
      xyz: 'Z',
      count: 1,
      totalValue: 4990,
      items: [tile('FTG-8841', 'PVC Elbow Fitting', 4990, 6.5, 2.41)],
    },
    {
      abc: 'C',
      xyz: 'X',
      count: 1,
      totalValue: 940.5,
      items: [tile('TAP-0021', 'Teflon Tape', 940.5, 1.3, 0.3)],
    },
    {
      abc: 'C',
      xyz: 'Y',
      count: 1,
      totalValue: 612,
      items: [tile('CLP-7740', 'Hose Clamp', 612, 2.9, 0.81)],
    },
    { abc: 'C', xyz: 'Z', count: 0, totalValue: 0, items: [] },
  ],
  awaitingSignal: [tile('NEW-0042', 'Drip Emitter (new)', 0, 0, 0)],
};

// Fixture conflicts for the Wave 6.3-C reconciliation-bench showcase. Real-feeling
// records, organic values (MASTER_PROMPT: never Acme / round demo numbers).
const GALLERY_CONFLICTS: PendingConflict[] = [
  {
    id: 'fx-product',
    entityType: 'product',
    entityId: 'fx-1',
    externalRef: 'QBO:1042',
    title: 'Galvanized Joist Hanger 2x10',
    subtitle: 'SKU-2231',
    policyDecision: 'needs_review',
    createdAt: '2026-06-10T13:02:00.000Z',
    localState: {
      name: 'Galv Joist Hanger 2x10',
      description: '18-gauge, triple-zinc',
      unitOfMeasure: 'ea',
      status: 'active',
    },
    remoteState: {
      name: 'Galvanized Joist Hanger 2x10',
      description: '18-gauge, triple-zinc',
      unitOfMeasure: 'box of 25',
      status: 'active',
    },
    fields: [
      {
        key: 'name',
        label: 'Name',
        local: 'Galv Joist Hanger 2x10',
        remote: 'Galvanized Joist Hanger 2x10',
        differs: true,
      },
      {
        key: 'description',
        label: 'Description',
        local: '18-gauge, triple-zinc',
        remote: '18-gauge, triple-zinc',
        differs: false,
      },
      {
        key: 'unitOfMeasure',
        label: 'Unit of measure',
        local: 'ea',
        remote: 'box of 25',
        differs: true,
      },
      { key: 'status', label: 'Status', local: 'active', remote: 'active', differs: false },
    ],
  },
  {
    id: 'fx-supplier',
    entityType: 'supplier',
    entityId: 'fx-2',
    externalRef: 'QBO:88',
    title: 'Atchafalaya Distributing',
    subtitle: null,
    policyDecision: 'needs_review',
    createdAt: '2026-06-10T12:41:00.000Z',
    localState: {
      name: 'Atchafalaya Distributing',
      status: 'active',
      contact: { email: 'orders@atchafalaya-dist.com' },
    },
    remoteState: {
      name: 'Atchafalaya Distributing',
      status: 'inactive',
      contact: { email: 'ap@atchafalaya-dist.com' },
    },
    fields: [
      {
        key: 'name',
        label: 'Name',
        local: 'Atchafalaya Distributing',
        remote: 'Atchafalaya Distributing',
        differs: false,
      },
      { key: 'status', label: 'Status', local: 'active', remote: 'inactive', differs: true },
      {
        key: 'contact',
        label: 'Contact',
        local: 'email: orders@atchafalaya-dist.com',
        remote: 'email: ap@atchafalaya-dist.com',
        differs: true,
      },
    ],
  },
];

/**
 * Phase 5G base-component gallery. Dev/CI only (404 in production). This is the
 * stand-in for Storybook — it renders every base component in every state so the
 * Phase 5 visible-craft screenshot can be captured (Playwright MCP). Real-feeling
 * fragments + organic numbers per MASTER_PROMPT; never Acme / round demo numbers.
 */
export default function GalleryPage() {
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <main className={styles.page}>
      <header className={styles.masthead}>
        <span className={styles.eyebrow}>THE CHAIN · FOUNDATION</span>
        <h1 className={styles.h1}>Base components</h1>
        <p className={styles.sub}>
          The daylight-engineering kit. Tokens only. Every consequential number is Plex Mono.
        </p>
      </header>

      {/* Metric strip — border-divides, not cards. */}
      <section className={styles.section}>
        <span className={styles.label}>METRIC STRIP</span>
        <div className={styles.strip}>
          <MetricCell
            label="FILL RATE"
            value="94.7"
            unit="%"
            delta={{ value: '1.8 pts', direction: 'up' }}
            deltaTone="flow"
          />
          <MetricCell
            label="STOCKOUTS / 30D"
            value="3"
            delta={{ value: '2 fewer', direction: 'down' }}
            deltaTone="flow"
          />
          <MetricCell
            label="AVG LEAD TIME"
            value="8.3"
            unit="days"
            delta={{ value: '0.4 slower', direction: 'up' }}
            deltaTone="warn"
          />
          <MetricCell
            label="OPEN PO VALUE"
            value="1,247.20"
            unit="$"
            unitPosition="prefix"
            tone="deep"
          />
          <MetricCell
            label="AT RISK"
            value="6"
            tone="stop"
            delta={{ value: '2 more', direction: 'up' }}
            deltaTone="stop"
          />
        </div>
      </section>

      {/* StatNumber */}
      <section className={styles.section}>
        <span className={styles.label}>STATNUMBER — sizes, tones, states</span>
        <div className={styles.row}>
          <StatNumber value="47.2" unit="%" size="hero" label="SERVICE LEVEL" />
          <StatNumber value="8.3" unit="days" size="panel" tone="warn" label="LEAD TIME" />
          <StatNumber
            value="1,247.20"
            unit="$"
            unitPosition="prefix"
            size="panel"
            tone="flow"
            label="ON ORDER"
          />
          <StatNumber value={42} size="body" label="REORDER QTY" />
          <StatNumber value={null} size="panel" label="NO POLICY" aria-label="no policy yet" />
          <StatNumber value={0} loading size="panel" label="LOADING" />
          <StatNumber value={0} error size="panel" label="FAILED" aria-label="forecast failed" />
        </div>
      </section>

      {/* ActionButton */}
      <section className={styles.section}>
        <span className={styles.label}>ACTIONBUTTON</span>
        <div className={styles.row}>
          <ActionButton>Approve PO</ActionButton>
          <ActionButton loading>Approving</ActionButton>
          <ActionButton disabled>Unavailable</ActionButton>
          <ActionButton variant="secondary">Dismiss recommendation</ActionButton>
        </div>
      </section>

      {/* The Chain — the signature object, with the ignite on the active link */}
      <section className={styles.section}>
        <span className={styles.label}>THE CHAIN — PO-4471 · Calhoun Foods</span>
        <div className={styles.chain}>
          <ChainLink
            step="SUPPLIER"
            label="Atchafalaya Distributing"
            when="Apr 14 · 08:10"
            state="done"
            connector="cobalt"
          />
          <ChainLink
            step="ORDERED"
            label="142 units"
            when="Apr 14 · 16:42"
            state="done"
            connector="cobalt"
          />
          <ChainLink
            step="IN TRANSIT"
            label="3 pallets"
            when="Apr 18 · 09:24"
            state="active"
            connector="pewter"
          />
          <ChainLink step="RECEIVED" label="Awaiting dock" state="pending" connector="pewter" />
          <ChainLink step="ON HAND" label="Not yet" state="pending" connector="none" />
        </div>
      </section>

      {/* Panel + ClaudeInsight */}
      <section className={styles.section}>
        <span className={styles.label}>PANEL — header, focused, empty, loading, error</span>
        <div className={styles.panelGrid}>
          <Panel
            prefix="REORDER QUEUE"
            title="Needs attention"
            actions={<ActionButton variant="secondary">View all</ActionButton>}
          >
            <ClaudeInsight topic="reorder" confidence={0.82}>
              Riverbend Hardware is 6.2 days from a stockout on SKU-2231 at current velocity. Lead
              time ran 9.1 days last quarter, so a PO placed today lands with about 2 days of
              buffer.
            </ClaudeInsight>
          </Panel>
          <Panel prefix="FORECAST" title="SKU-2231 · 90-day" focused>
            <StatNumber value="312.4" unit="units" size="hero" label="PROJECTED DEMAND" />
            <div className={styles.spacer} />
            <ClaudeInsight topic="forecast" loading />
          </Panel>
          <Panel
            prefix="ALERTS"
            title="Flow"
            empty
            emptyMessage="No open alerts. The bench is clear."
          />
          <Panel prefix="SUPPLIERS" title="Scorecards" loading />
          <Panel
            prefix="SYNC"
            title="QuickBooks Online"
            error
            errorMessage="Last sync failed at 09:02. Retrying in 12 min."
          />
        </div>
      </section>

      {/* Sync-conflict reconciliation bench (Wave 6.3-C). */}
      <section className={styles.section}>
        <span className={styles.label}>SYNC CONFLICTS — reconciliation bench + resolved state</span>
        <ConflictCockpit conflicts={GALLERY_CONFLICTS} />
        <div className={conflictStyles.reconciled} style={{ marginTop: 'var(--spacing-5)' }}>
          <span className={conflictStyles.reconciledLink} aria-hidden="true" />
          <div className={conflictStyles.reconciledText}>
            <span className={conflictStyles.reconciledStep}>RECONCILED</span>
            <span className={conflictStyles.reconciledLabel}>Galvanized Joist Hanger 2x10</span>
            <span className={conflictStyles.reconciledNote}>Merged field by field</span>
          </div>
        </div>
      </section>

      {/* ABC/XYZ classification — badges + the value × variability quadrant (Block 7). */}
      <section className={styles.section}>
        <span className={styles.label}>
          CLASSIFICATION BADGE — ABC value rank · XYZ variability
        </span>
        <div className={styles.row}>
          <ClassificationBadge abc="A" xyz="X" size="md" />
          <ClassificationBadge abc="A" xyz="Z" size="md" />
          <ClassificationBadge abc="B" xyz="Y" size="md" />
          <ClassificationBadge abc="C" xyz="Z" size="md" />
          <ClassificationBadge abc="A" xyz={null} size="md" />
          <ClassificationBadge abc={null} xyz={null} size="md" />
        </div>
      </section>

      <section className={styles.section}>
        <span className={styles.label}>
          CLASSIFICATION QUADRANT — value × variability, watch corner lit
        </span>
        <QuadrantGrid quadrant={GALLERY_QUADRANT} />
      </section>
    </main>
  );
}
