// Load local env (Supabase URL + anon/service keys) for integration tests that
// hit the live PostgREST/auth API. Next loads .env.local itself; vitest does not.
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

// Extends Vitest's `expect` with jest-dom matchers (toBeInTheDocument, etc.).
// Safe to load for node-env DB tests too — it only augments the matcher set.
import '@testing-library/jest-dom/vitest';

// Auto-unmount React trees between tests so repeated renders don't accumulate in
// the DOM (otherwise getByRole('button') finds multiples). Guarded to jsdom: the
// node-env DB tests have no `document`, where cleanup() would throw.
if (typeof document !== 'undefined') {
  const { cleanup } = await import('@testing-library/react');
  const { afterEach } = await import('vitest');
  afterEach(cleanup);
}
