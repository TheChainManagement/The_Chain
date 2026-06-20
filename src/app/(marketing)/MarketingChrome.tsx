'use client';

import { usePathname } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
import { capturePageview, initAnalytics } from '@/lib/analytics';
import styles from './marketing.module.css';

/**
 * Marketing chrome — the two perpetual/scroll motions the design direction
 * requires on public pages, plus PostHog page-view capture on route change.
 *   - Signal scan: a 1px cobalt hairline traces left→right across the top.
 *   - Scroll progress: a top hairline driven by `transform: scaleX()` (never
 *     width), per the taste-skill rule. Reduced-motion is honored in CSS.
 */
export function MarketingChrome(): ReactNode {
  const pathname = usePathname();

  useEffect(() => {
    initAnalytics();
  }, []);

  useEffect(() => {
    capturePageview(pathname);
  }, [pathname]);

  useEffect(() => {
    const bar = document.getElementById('mkt-progress');
    if (!bar) return;
    const update = () => {
      const h = document.documentElement;
      const max = h.scrollHeight - h.clientHeight;
      bar.style.transform = `scaleX(${max > 0 ? h.scrollTop / max : 0})`;
    };
    window.addEventListener('scroll', update, { passive: true });
    update();
    return () => window.removeEventListener('scroll', update);
  }, []);

  return (
    <>
      <div className={styles.signalScan} aria-hidden="true" />
      <div className={styles.progress} id="mkt-progress" aria-hidden="true" />
    </>
  );
}
