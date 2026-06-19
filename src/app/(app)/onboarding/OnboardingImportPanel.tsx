'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, useTransition } from 'react';
import { ImportWorkbench } from '@/app/(app)/import/ImportWorkbench';
import type { KindSpec } from '@/lib/import/field-specs';
import styles from './onboarding.module.css';

/**
 * Inline CSV import, in the onboarding chain (Block 2 Wave 2b). Embeds the Block 5
 * ImportWorkbench (products / suppliers / sales lanes) as-is — same upload → map →
 * preview → commit flow, no duplication. Imports write through RLS to products and
 * suppliers; "Continue setup" refreshes the route so the chain advances from the
 * real counts (Catalog/Suppliers light once a lane lands).
 */
export function OnboardingImportPanel({ specs }: { specs: KindSpec[] }): ReactNode {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className={styles.importPanel}>
      <p className={styles.stepLead}>
        Import your products first, then switch to the suppliers lane. Each lane lights its link in
        the chain above. When both are in, continue to your first forecast.
      </p>
      <ImportWorkbench specs={specs} />
      <button
        type="button"
        className={styles.continueLink}
        onClick={() => startTransition(() => router.refresh())}
        disabled={pending}
      >
        {pending ? 'Checking…' : 'Continue setup →'}
      </button>
    </div>
  );
}
