'use client';

import { type ReactNode, useState } from 'react';
import type { ImportableKind, KindSpec } from '@/lib/import/field-specs';
import { ImportFlow } from './ImportFlow';
import styles from './import.module.css';

/**
 * ImportWorkbench — the kind selector + active flow (Block 5, Wave 5.2).
 *
 * Three ingestion lanes (products / suppliers / sales & movements). Selecting a
 * lane re-keys ImportFlow so the upload→map→preview state resets cleanly — you
 * never carry a product mapping into a supplier file. The active lane carries
 * the cobalt signal, the surface's single intent slot.
 */
export function ImportWorkbench({ specs }: { specs: KindSpec[] }): ReactNode {
  const [active, setActive] = useState<ImportableKind>(specs[0]?.kind ?? 'product');
  const activeSpec = specs.find((s) => s.kind === active) ?? specs[0];

  return (
    <div className={styles.workbench}>
      <div className={styles.kindTabs} role="tablist" aria-label="What are you importing?">
        {specs.map((spec) => {
          const selected = spec.kind === active;
          return (
            <button
              key={spec.kind}
              type="button"
              role="tab"
              aria-selected={selected}
              className={styles.kindTab}
              data-active={selected}
              onClick={() => setActive(spec.kind)}
            >
              <span className={styles.kindTabLabel}>{spec.label}</span>
              <span className={styles.kindTabBlurb}>{spec.blurb}</span>
              <span className={styles.kindTabRail} aria-hidden="true" />
            </button>
          );
        })}
      </div>

      {activeSpec ? <ImportFlow key={activeSpec.kind} spec={activeSpec} /> : null}
    </div>
  );
}
