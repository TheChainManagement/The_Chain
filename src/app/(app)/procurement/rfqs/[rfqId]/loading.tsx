import type { ReactNode } from 'react';
import { PageHeader } from '@/components/bench/PageHeader';
import pageStyles from '@/components/bench/page.module.css';
import { Panel } from '@/components/Panel/Panel';

/** RFQ detail loading state — header placeholder + streaming document panel. */
export default function RfqDetailLoading(): ReactNode {
  return (
    <div className={pageStyles.stack}>
      <PageHeader eyebrow="Procurement · request for quote" title="Quote request" />
      <Panel prefix="Procurement" title="Loading the request" loading />
    </div>
  );
}
