import Link from 'next/link';
import { PageHeader } from '@/components/bench/PageHeader';
import pageStyles from '@/components/bench/page.module.css';
import { ChainLink } from '@/components/ChainLink/ChainLink';
import { MetricCell } from '@/components/MetricCell/MetricCell';
import { Panel } from '@/components/Panel/Panel';

export const metadata = { title: 'Today · The Chain' };

/**
 * Today — the bench landing. At 5H this is the EMPTY BENCH state: no source is
 * connected yet, so the metric strip reads as dashes, the chain waits in
 * pending, and the surface invites connecting QuickBooks. Once a source lands
 * (Phase 6), these same surfaces fill in place.
 */
export default function TodayPage() {
  return (
    <div className={pageStyles.stack}>
      <PageHeader eyebrow="The bench · waiting on a source" title="Today" />

      {/* Metric strip — shape is wired; values arrive with the first sync. */}
      <div className={pageStyles.strip}>
        <MetricCell label="FILL RATE" value={null} unit="%" />
        <MetricCell label="STOCKOUTS / 30D" value={null} />
        <MetricCell label="AVG LEAD TIME" value={null} unit="days" />
        <MetricCell label="OPEN PO VALUE" value={null} unit="$" unitPosition="prefix" />
        <MetricCell label="AT RISK" value={null} />
      </div>

      <Panel prefix="Get started" title="Connect a source to fill the bench">
        <div className={pageStyles.connect}>
          <p className={pageStyles.connectCopy}>
            The Chain reads your catalog, suppliers, and purchase history from QuickBooks Online,
            then watches every PO advance link by link. Nothing here is guesswork. Connect a source
            and the bench fills in place.
          </p>
          <Link href="/settings" className={pageStyles.cta}>
            Connect QuickBooks Online
          </Link>
        </div>
      </Panel>

      <Panel prefix="Preview" title="What a live PO chain looks like">
        <div className={pageStyles.chain}>
          <ChainLink step="SUPPLIER" label="Awaiting source" state="pending" connector="pewter" />
          <ChainLink step="ORDERED" label="Not yet" state="pending" connector="pewter" />
          <ChainLink step="IN TRANSIT" label="Not yet" state="pending" connector="pewter" />
          <ChainLink step="RECEIVED" label="Not yet" state="pending" connector="pewter" />
          <ChainLink step="ON HAND" label="Not yet" state="pending" connector="none" />
        </div>
      </Panel>
    </div>
  );
}
