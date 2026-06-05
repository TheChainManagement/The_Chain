import type { ReactNode } from 'react';
import { PageHeader } from '@/components/bench/PageHeader';
import pageStyles from '@/components/bench/page.module.css';
import { ConnectPanel } from './ConnectPanel';

export const metadata = { title: 'QuickBooks Online · The Chain' };

/**
 * QuickBooks Online connect screen (Block 6). Server Component shell; the
 * interactive connect + chain reveal lives in `ConnectPanel`.
 */
export default function QuickBooksPage(): ReactNode {
  return (
    <div className={pageStyles.stack}>
      <PageHeader eyebrow="Integrations · native two-way sync" title="QuickBooks Online" />
      <ConnectPanel />
    </div>
  );
}
