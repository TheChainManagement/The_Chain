import type { ReactNode } from 'react';
import { PageHeader } from '@/components/bench/PageHeader';
import pageStyles from '@/components/bench/page.module.css';
import { Panel } from '@/components/Panel/Panel';

/** Requisition detail loading state — header placeholder + streaming panel. */
export default function RequisitionDetailLoading(): ReactNode {
  return (
    <div className={pageStyles.stack}>
      <PageHeader eyebrow="Procurement · requisition" title="Requisition" />
      <Panel prefix="Procurement" title="Loading the requisition" loading />
    </div>
  );
}
