'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { track } from '@/lib/analytics';

/**
 * The "Get started" CTA. A Link to /signup that fires the conversion event first
 * (no-op until PostHog is keyed). `location` distinguishes the nav CTA from the
 * hero CTA in the funnel. Signup leads into plan selection + checkout (Block 16
 * hard paywall — no free trial).
 */
export function GetStartedCta({
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
      onClick={() => track('get_started_clicked', { location })}
    >
      {children}
    </Link>
  );
}
