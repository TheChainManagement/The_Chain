'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { track } from '@/lib/analytics';

/**
 * The "Start 14-day trial" CTA. A Link to /signup that fires the trial-conversion
 * event first (no-op until PostHog is keyed). `location` distinguishes the nav
 * CTA from the hero CTA in the funnel.
 */
export function TrialCta({
  className,
  children,
  location,
}: {
  className?: string;
  children: ReactNode;
  location: string;
}): ReactNode {
  return (
    <Link
      href="/signup"
      className={className}
      onClick={() => track('trial_start_clicked', { location })}
    >
      {children}
    </Link>
  );
}
