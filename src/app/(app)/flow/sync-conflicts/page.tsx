import Link from 'next/link';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/bench/PageHeader';
import pageStyles from '@/components/bench/page.module.css';
import { Panel } from '@/components/Panel/Panel';
import { listPendingConflicts } from '@/lib/qbo/conflicts';
import { createSupabaseServer } from '@/lib/supabase/server';
import { ConflictCockpit } from './ConflictCockpit';
import styles from './sync-conflicts.module.css';

export const metadata = { title: 'Sync Conflicts · The Chain' };

/**
 * Sync-conflicts cockpit (Block 6, Wave 6.3-C). Server shell: RLS-scoped pending
 * conflicts the incremental sync couldn't auto-resolve, handed to the interactive
 * reconciliation bench. This is the surface the "N changes need review" badge on
 * the QuickBooks screen routes into — the end of what used to be a dead-end.
 */
export default async function SyncConflictsPage(): Promise<ReactNode> {
  const supabase = await createSupabaseServer();
  const conflicts = await listPendingConflicts(supabase);

  if (conflicts.length === 0) {
    return (
      <div className={pageStyles.stack}>
        <PageHeader eyebrow="Flow · reconciliation" title="Sync Conflicts" />
        <Panel prefix="Conflicts" title="Everything reconciles">
          <p className={styles.emptyCopy}>
            No records need review. When QuickBooks and an in-app edit change the same field at the
            same time, the change waits here for you to pick a winner.
          </p>
          <Link href="/integrations/quickbooks" className={styles.emptyLink}>
            Back to QuickBooks
          </Link>
        </Panel>
      </div>
    );
  }

  return (
    <div className={pageStyles.stack}>
      <PageHeader eyebrow="Flow · reconciliation" title="Sync Conflicts" />
      <ConflictCockpit conflicts={conflicts} />
    </div>
  );
}
