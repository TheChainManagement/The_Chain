/**
 * Phase 5E — Workflow DevKit smoke endpoint.
 *
 * Dev/CI only. Triggers `foundationSmokeWorkflow` and awaits its return value
 * so a single curl proves the full round-trip:
 *   POST /api/smoke  ->  start()  ->  "use step" x2  ->  return value.
 *
 * Guarded to 404 in production: this is a wiring probe, not a product surface.
 * (NB: a `_smoke`-style underscore folder is a Next App Router *private* folder
 * and is not routable — the route segment must be `smoke`, not `_smoke`.)
 */

import { NextResponse } from 'next/server';
import { start } from 'workflow/api';
import { foundationSmokeWorkflow } from '@/workflows/smoke';

export async function POST() {
  if (process.env.NODE_ENV === 'production') {
    return new NextResponse('Not found', { status: 404 });
  }

  const seed = 21;
  const run = await start(foundationSmokeWorkflow, [seed]);
  const result = await run.returnValue;

  return NextResponse.json({ runId: run.runId, result });
}
