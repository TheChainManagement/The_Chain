'use client';

import { useEffect, useRef } from 'react';
import styles from './marketing.module.css';

/**
 * HeroScrubber — the signature "inspect the print" detail. Hovering the hero
 * model reveals a cobalt crosshair marker with a live mono coordinate readout,
 * as if measuring an engineering drawing. Position is driven straight onto CSS
 * variables via a rAF-batched pointer handler (never React state per frame, per
 * the taste-skill rule for cursor effects), so it costs no re-renders. Pointer-
 * fine only; hidden on touch and under reduced-motion (CSS guards both).
 */
export function HeroScrubber() {
  const ref = useRef<HTMLDivElement>(null);
  const readoutRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fine = window.matchMedia?.('(pointer: fine)');
    if (!fine?.matches) return;

    let frame = 0;
    let px = 0;
    let py = 0;

    const onMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      px = (e.clientX - rect.left) / rect.width;
      py = (e.clientY - rect.top) / rect.height;
      if (px < 0 || px > 1 || py < 0 || py > 1) {
        el.dataset.on = '';
        return;
      }
      el.dataset.on = 'true';
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        el.style.setProperty('--mx', `${(px * 100).toFixed(2)}%`);
        el.style.setProperty('--my', `${(py * 100).toFixed(2)}%`);
        const ro = readoutRef.current;
        if (ro) {
          // A drafting-style coordinate readout: pseudo grid refs, not raw px.
          const gx = (px * 24).toFixed(1).padStart(4, '0');
          const gy = (py * 16).toFixed(1).padStart(4, '0');
          ro.textContent = `X ${gx} · Y ${gy}`;
        }
      });
    };

    const onLeave = () => {
      el.dataset.on = '';
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={ref} className={styles.scrubber} aria-hidden="true">
      <span className={styles.scrubV} />
      <span className={styles.scrubH} />
      <span className={styles.scrubNode} />
      <span ref={readoutRef} className={styles.scrubReadout}>
        X 0000 · Y 0000
      </span>
    </div>
  );
}
