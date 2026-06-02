import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Foundation test config. Two kinds of tests live here:
 *   - Component tests (tsx): React Testing Library, opt into jsdom per-file with
 *     a `// @vitest-environment jsdom` docblock at the top of the file.
 *   - DB integration tests (audit triggers now; RLS + role-matrix + wired-for
 *     probes at 5I): connect to local Supabase Postgres via `pg`, node env.
 *     Require `supabase start` running.
 *
 * Global env is `node`; jsdom is opt-in so DB tests stay fast. Workflow
 * integration tests get their own config with `@workflow/vitest` later.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    // Mirror the tsconfig `@/*` -> `src/*` path alias so tests can import app code.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'src/**/*.test.tsx'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // DB tests share one Postgres; run files serially to avoid interference.
    fileParallelism: false,
  },
});
