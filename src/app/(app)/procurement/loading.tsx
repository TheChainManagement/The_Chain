import type { ReactNode } from 'react';
import { PageHeader } from '@/components/bench/PageHeader';
import pageStyles from '@/components/bench/page.module.css';
import { Panel } from '@/components/Panel/Panel';

/**
 * Procurement segment loading state (MASTER_PROMPT: every async surface gets a
 * loading state). Header holds its place; the ledger streams in.
 */
export default function ProcurementLoading(): ReactNode {
  return (
    <div className={pageStyles.stack}>
      <PageHeader eyebrow="Procurement · request for quote" title="Quote requests" />
      <Panel prefix="Procurement" title="Loading quote requests" loading />
    </div>
  );
}
