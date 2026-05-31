import { defineConfig } from 'vitest/config';

/**
 * Foundation DB + unit test config. Node environment, no jsdom.
 *
 * DB integration tests (audit triggers now; RLS + role-matrix + wired-for
 * probes at 5I) connect to the local Supabase Postgres via `pg`. They require
 * `supabase start` to be running. Workflow integration tests (later) get their
 * own config with the `@workflow/vitest` plugin, kept separate per the
 * Workflow DevKit testing guidance.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // DB tests share one Postgres; run files serially to avoid cross-test
    // interference on the audit_log table.
    fileParallelism: false,
  },
});
