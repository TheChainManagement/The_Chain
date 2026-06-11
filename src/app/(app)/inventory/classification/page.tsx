import type { ReactNode } from 'react';
import { PageHeader } from '@/components/bench/PageHeader';
import pageStyles from '@/components/bench/page.module.css';
import { Panel } from '@/components/Panel/Panel';
import { loadQuadrant } from '@/lib/classification/queries';
import { createSupabaseServer } from '@/lib/supabase/server';
import { ClassificationControls } from './ClassificationControls';
import styles from './classification.module.css';
import { QuadrantGrid } from './QuadrantGrid';

export const metadata = { title: 'Classification · The Chain' };

/**
 * ABC/XYZ classification cockpit (Block 7). Server shell: loads the RLS-scoped
 * quadrant snapshot and hands it to the presentational grid. The catalog plotted
 * on the value × variability grid — the A/B·Z watch corner (valuable + hard to
 * forecast) is lit so it reads at a glance.
 */
export default async function ClassificationPage(): Promise<ReactNode> {
  const supabase = await createSupabaseServer();
  const quadrant = await loadQuadrant(supabase);

  const isEmpty = quadrant.classified === 0 && quadrant.awaitingSignal.length === 0;

  return (
    <div className={pageStyles.stack}>
      <PageHeader eyebrow="Inventory · value × variability" title="Classification" />
      <ClassificationControls computedAt={quadrant.computedAt} />

      {isEmpty ? (
        <Panel prefix="ABC · XYZ" title="Nothing classified yet">
          <p className={styles.emptyCopy}>
            Run a classification pass to rank every SKU by consumption value (ABC) and demand
            variability (XYZ). It reads the last 12 months of sales, so connect a source and sync
            first if the catalog is empty.
          </p>
        </Panel>
      ) : (
        <QuadrantGrid quadrant={quadrant} />
      )}
    </div>
  );
}
