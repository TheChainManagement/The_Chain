import { fileURLToPath } from 'node:url';
import { workflow } from '@workflow/vitest';
import { defineConfig } from 'vitest/config';

/**
 * Workflow integration tests (Block 11b). The `@workflow/vitest` plugin runs
 * durable workflows in-process — no dev server — so `createHook` / `resumeHook`
 * and long `sleep`s can be driven deterministically. Kept separate from the
 * main config because the plugin compiles the `"use workflow"`/`"use step"`
 * directives; the main suite must NOT load it.
 *
 *   npx vitest run --config vitest.integration.config.ts
 */
export default defineConfig({
  plugins: [workflow()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'server-only': fileURLToPath(new URL('./tests/stubs/empty.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.integration.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
