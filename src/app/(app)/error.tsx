'use client';

import { useEffect } from 'react';
import { ActionButton } from '@/components/ActionButton/ActionButton';
import { PageHeader } from '@/components/bench/PageHeader';
import pageStyles from '@/components/bench/page.module.css';
import { Panel } from '@/components/Panel/Panel';

/**
 * Bench-segment error boundary (Block 3+4 Codex finding: feature pages threw raw
 * Errors with no route-level surface). Catches anything a bench surface throws
 * while loading data (listInventory / getProductDetail / supplier queries) and
 * renders it inside the existing rails instead of crashing to the root boundary.
 *
 * Client Component per the App Router error.tsx contract; `reset()` re-renders
 * the segment so a transient failure recovers without a full reload. The layout
 * (rails + auth gate) stays mounted — only the surface content is replaced.
 */
export default function BenchError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[bench] surface error:', error);
  }, [error]);

  return (
    <div className={pageStyles.stack}>
      <PageHeader eyebrow="Bench · interrupted" title="This surface stalled" />
      <Panel
        prefix="Error"
        title="Couldn't load this surface"
        error
        errorMessage="Something went wrong pulling this data. Your work is safe. Try again, and if it keeps happening, reload the bench."
        actions={
          <ActionButton variant="primary" onClick={reset}>
            Try again
          </ActionButton>
        }
      />
    </div>
  );
}
