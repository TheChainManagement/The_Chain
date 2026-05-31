import { notFound } from 'next/navigation';
import { ActionButton } from '@/components/ActionButton/ActionButton';
import { ChainLink } from '@/components/ChainLink/ChainLink';
import { ClaudeInsight } from '@/components/ClaudeInsight/ClaudeInsight';
import { MetricCell } from '@/components/MetricCell/MetricCell';
import { Panel } from '@/components/Panel/Panel';
import { StatNumber } from '@/components/StatNumber/StatNumber';
import styles from './gallery.module.css';

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
    </main>
  );
}
