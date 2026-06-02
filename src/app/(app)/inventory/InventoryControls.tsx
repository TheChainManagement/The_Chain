'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { StatusFilter } from '@/lib/inventory/transform';
import styles from './inventory.module.css';

/**
 * InventoryControls — search + status filter for the catalog ledger. Client
 * island that drives the URL (?q=&status=); the Server Component re-reads the
 * params and re-queries, so filtering stays server-side and scales to the 5k
 * bench. Search is debounced; status is immediate. Selected segment is the
 * single selected state for this control (deep fill, never cobalt — the Add SKU
 * CTA owns cobalt on this surface).
 */

const STATUSES: { value: StatusFilter; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'discontinued', label: 'Discontinued' },
  { value: 'all', label: 'All' },
];

export function InventoryControls({
  search,
  status,
}: {
  search: string;
  status: StatusFilter;
}): React.ReactNode {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [term, setTerm] = useState(search);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the input in sync if the URL changes from elsewhere (back/forward).
  useEffect(() => {
    setTerm(search);
  }, [search]);

  function push(next: { q?: string; status?: StatusFilter }): void {
    const sp = new URLSearchParams(params.toString());
    if (next.q !== undefined) {
      if (next.q.trim()) {
        sp.set('q', next.q);
      } else {
        sp.delete('q');
      }
    }
    if (next.status !== undefined) {
      if (next.status === 'active') {
        sp.delete('status');
      } else {
        sp.set('status', next.status);
      }
    }
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function onSearch(value: string): void {
    setTerm(value);
    if (debounce.current) {
      clearTimeout(debounce.current);
    }
    debounce.current = setTimeout(() => push({ q: value }), 220);
  }

  return (
    <div className={styles.controls}>
      <div className={styles.searchWrap}>
        <span className={styles.searchGlyph} aria-hidden="true" />
        <input
          type="search"
          className={styles.search}
          placeholder="Search SKU or name"
          value={term}
          onChange={(e) => onSearch(e.target.value)}
          aria-label="Search the catalog by SKU or product name"
        />
      </div>

      <fieldset className={styles.segmented}>
        <legend className={styles.srOnly}>Filter by status</legend>
        {STATUSES.map((s) => {
          const active = s.value === status;
          return (
            <button
              key={s.value}
              type="button"
              className={`${styles.segment} ${active ? styles.segmentActive : ''}`}
              aria-pressed={active}
              onClick={() => push({ status: s.value })}
            >
              {s.label}
            </button>
          );
        })}
      </fieldset>
    </div>
  );
}
