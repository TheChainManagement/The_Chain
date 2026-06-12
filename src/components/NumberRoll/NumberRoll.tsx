'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';
import styles from './NumberRoll.module.css';

/**
 * NumberRoll — the counter-roll tick for live-updating consequential numbers
 * (Block 9 what-if ribbon). Wraps its child (a StatNumber — the canonical
 * number path stays intact) and plays a quick roll-in whenever `signal`
 * changes. Motion tokens only; `prefers-reduced-motion` disables the roll.
 */
export function NumberRoll({
  signal,
  children,
}: {
  /** Any primitive that changes when the displayed value changes. */
  signal: string | number;
  children: ReactNode;
}): ReactNode {
  const [rolling, setRolling] = useState(false);
  const prev = useRef(signal);

  useEffect(() => {
    if (prev.current === signal) return;
    prev.current = signal;
    setRolling(true);
    const t = setTimeout(() => setRolling(false), 200);
    return () => clearTimeout(t);
  }, [signal]);

  return (
    <span className={styles.roll} data-rolling={rolling || undefined} data-testid="number-roll">
      <span key={String(signal)} className={styles.face}>
        {children}
      </span>
    </span>
  );
}
