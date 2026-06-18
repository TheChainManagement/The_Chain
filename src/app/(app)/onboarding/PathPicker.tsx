'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, useState, useTransition } from 'react';
import type { OnboardingPath } from '@/lib/onboarding/state';
import { pickPath } from './actions';
import styles from './onboarding.module.css';

/**
 * The path-picker: the first onboarding choice (FEATURES step 1). Three routes
 * into the workshop. "Starting fresh" stays inline (guided forms); QuickBooks and
 * spreadsheet set the path, then hand off to the existing connect/import surfaces
 * — the chain lights Catalog/Suppliers as that data lands. Wave 2b streams the
 * sync progress inside the chain itself.
 */

interface Option {
  path: OnboardingPath;
  title: string;
  blurb: string;
  /** Where the operator goes after the path is set. null ⇒ stay (fresh). */
  href: string | null;
}

const OPTIONS: Option[] = [
  {
    path: 'qbo',
    title: 'I use QuickBooks',
    blurb: 'Connect QuickBooks Online. We read your items, vendors, and history.',
    href: '/integrations/quickbooks',
  },
  {
    path: 'csv',
    title: 'I have a spreadsheet',
    blurb: 'Upload a CSV of products, suppliers, or sales. Map the columns, preview, import.',
    href: '/import',
  },
  {
    path: 'fresh',
    title: "I'm starting fresh",
    blurb: 'Add your first product and supplier by hand. The Chain takes it from there.',
    href: null,
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
      if (option.href) {
        router.push(option.href);
      } else {
        router.refresh();
      }
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
