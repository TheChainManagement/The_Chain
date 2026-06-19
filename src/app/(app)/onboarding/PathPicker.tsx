'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, useState, useTransition } from 'react';
import type { OnboardingPath } from '@/lib/onboarding/state';
import { pickPath } from './actions';
import styles from './onboarding.module.css';

/**
 * The path-picker: the first onboarding choice (FEATURES step 1). Three routes
 * into the workshop, all run IN the flow (Wave 2b): picking a path refreshes
 * /onboarding, which then renders the matching inline panel — QuickBooks connect
 * + sync, the CSV import workbench, or the fresh guided forms. The chain fills in
 * place either way.
 */

interface Option {
  path: OnboardingPath;
  title: string;
  blurb: string;
}

const OPTIONS: Option[] = [
  {
    path: 'qbo',
    title: 'I use QuickBooks',
    blurb: 'Connect QuickBooks Online. We read your items, vendors, and history.',
  },
  {
    path: 'csv',
    title: 'I have a spreadsheet',
    blurb: 'Upload a CSV of products, suppliers, or sales. Map the columns, preview, import.',
  },
  {
    path: 'fresh',
    title: "I'm starting fresh",
    blurb: 'Add your first product and supplier by hand. The Chain takes it from there.',
  },
];

export function PathPicker(): ReactNode {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [chosen, setChosen] = useState<OnboardingPath | null>(null);
  const [error, setError] = useState<string | null>(null);

  function choose(option: Option) {
    setError(null);
    setChosen(option.path);
    startTransition(async () => {
      const result = await pickPath(option.path);
      if (!result.ok) {
        setError(result.error);
        setChosen(null);
        return;
      }
      // Every path now renders an inline panel on /onboarding; refresh to re-derive.
      router.refresh();
    });
  }

  return (
    <div className={styles.pathGroup}>
      <div className={styles.pathOptions}>
        {OPTIONS.map((option) => (
          <button
            key={option.path}
            type="button"
            className={styles.pathCard}
            onClick={() => choose(option)}
            disabled={pending}
            aria-busy={pending && chosen === option.path}
          >
            <span className={styles.pathTitle}>{option.title}</span>
            <span className={styles.pathBlurb}>{option.blurb}</span>
            <span className={styles.pathGo} aria-hidden="true">
              {pending && chosen === option.path ? 'Setting up…' : 'Start →'}
            </span>
          </button>
        ))}
      </div>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
