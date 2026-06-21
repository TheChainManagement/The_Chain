/**
 * Marketing analytics (Block 17) — a thin, key-gated PostHog wrapper.
 *
 * Every call is a no-op until `NEXT_PUBLIC_POSTHOG_KEY` is set, so the marketing
 * surface ships and runs with zero analytics config; the moment a PostHog project
 * key lands in the env, page views and the trial-conversion event start flowing.
 * Same pattern the More App uses. Client-only — guarded on `window`.
 */

import posthog from 'posthog-js';

let initialized = false;

function enabled(): boolean {
  return typeof window !== 'undefined' && Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY);
}

/** Initialize PostHog once, lazily, only when a key is configured. */
export function initAnalytics(): void {
  if (initialized || !enabled()) return;
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY as string, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
    // We capture page views manually on route change (App Router has no full reload).
    capture_pageview: false,
    person_profiles: 'identified_only',
    defaults: '2025-05-24',
  });
  initialized = true;
}

/** Manual page-view capture on client-side navigation. */
export function capturePageview(path: string): void {
  if (!enabled()) return;
  posthog.capture('$pageview', { $current_url: window.location.href, path });
}

/** The marketing funnel events we track. Extend as pages land. */
export type MarketingEvent = 'get_started_clicked' | 'signin_clicked' | 'how_it_works_clicked';

export function track(event: MarketingEvent, props?: Record<string, unknown>): void {
  if (!enabled()) return;
  posthog.capture(event, props);
}
