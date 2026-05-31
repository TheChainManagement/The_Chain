import type { ReactNode } from 'react';
import { Panel } from '@/components/Panel/Panel';
import { PageHeader } from './PageHeader';
import styles from './page.module.css';

/**
 * BenchStub — a bench surface whose feature lands in a later wave. The route,
 * the rail entry, and the layout are wired now (release-in-waves); the panel
 * states the wave so the shell is navigable and honest, not a dead 404.
 */
export function BenchStub({
  eyebrow,
  title,
  prefix,
  message,
}: {
  eyebrow: string;
  title: string;
  prefix: string;
  message: string;
}): ReactNode {
  return (
    <div className={styles.stack}>
      <PageHeader eyebrow={eyebrow} title={title} />
      <Panel prefix={prefix} title="Lands in a later wave" empty emptyMessage={message} />
    </div>
  );
}
