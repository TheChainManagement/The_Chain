import type { NextConfig } from 'next';
import { withWorkflow } from 'workflow/next';

/**
 * Next.js 16+ App Router. Turbopack is the default bundler.
 *
 * Cache Components (cacheComponents: true) enables Partial Prerendering:
 * mix static, cached, and dynamic content in a single route. SYSTEM_DESIGN.md
 * §Frontend architecture commits to this pattern: Server Components by default,
 * `'use cache'` for tenant-scoped data with `cacheTag()`, dynamic via Suspense.
 *
 * No Edge runtime; everything runs on Vercel Fluid Compute Node per
 * SYSTEM_DESIGN.md §Backend architecture.
 *
 * withWorkflow() (Phase 5E) enables the `"use workflow"` / `"use step"`
 * directives for durable orchestration. SYSTEM_DESIGN.md §Workflows commits to
 * Workflow DevKit for onboarding, QBO sync, forecast batch, PO lifecycle,
 * alert generation, and cold archive. It must wrap the exported config.
 */
const config: NextConfig = {
  reactStrictMode: true,
  cacheComponents: true,
};

export default withWorkflow(config);
