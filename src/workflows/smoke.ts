/**
 * Phase 5E — Workflow DevKit smoke test.
 *
 * The single purpose of this file is to prove the Workflow DevKit is wired
 * correctly end-to-end before any real workflow (onboarding, QBO sync, forecast
 * batch, PO lifecycle, alerts, cold archive) is built in Phase 6. It is NOT a
 * product feature and ships no UI.
 *
 * It deliberately demonstrates the directive boundary the Foundation Codex
 * review pressure-tests:
 *   - The orchestrator carries `"use workflow"` and ONLY orchestrates.
 *   - All I/O (here: clock read + logging) lives in `"use step"` units, which
 *     get full Node.js access, automatic retry, and replay-persisted results.
 *
 * Acceptance (FEATURES.md §Wave 1 Foundation, criterion 5):
 *   start() -> "use step" round-trip -> return value.
 */

/**
 * I/O step. Steps run on their own request with full Node.js access; their
 * return value is persisted for deterministic replay. We log at entry and exit
 * so a hung run is debuggable via `npx workflow web` / the dev server logs.
 */
async function echoStep(seed: number): Promise<{ seed: number; doubled: number; at: string }> {
  'use step';

  console.log(`[smoke] echoStep enter seed=${seed}`);
  const result = {
    seed,
    doubled: seed * 2,
    // Date.now() is Node I/O and is therefore legal inside a step (it would be
    // non-deterministic and illegal inside the "use workflow" sandbox).
    at: new Date().toISOString(),
  };
  console.log(`[smoke] echoStep exit doubled=${result.doubled} at=${result.at}`);
  return result;
}

/**
 * A second step, so the smoke run exercises a multi-step round-trip rather than
 * a single hop. Pure transform, but it still runs as a durable step.
 */
async function summarizeStep(input: {
  seed: number;
  doubled: number;
  at: string;
}): Promise<string> {
  'use step';

  console.log(`[smoke] summarizeStep enter seed=${input.seed}`);
  const summary = `seed ${input.seed} doubled to ${input.doubled} at ${input.at}`;
  console.log(`[smoke] summarizeStep exit "${summary}"`);
  return summary;
}

/**
 * Orchestrator. `"use workflow"` runs in the sandboxed VM: no fs, no fetch, no
 * clock — it only sequences steps and returns a serializable value.
 */
export async function foundationSmokeWorkflow(
  seed: number,
): Promise<{ ok: true; seed: number; doubled: number; summary: string }> {
  'use workflow';

  const echoed = await echoStep(seed);
  const summary = await summarizeStep(echoed);

  return { ok: true, seed: echoed.seed, doubled: echoed.doubled, summary };
}
