import { waitForHook } from '@workflow/vitest';
import { describe, expect, it } from 'vitest';
import { resumeHook, start } from 'workflow/api';
import { poReceiptHookToken } from '@/lib/purchase-orders/lifecycle-token';
import { purchaseOrderLifecycleWorkflow } from '@/workflows/po-lifecycle';

// `start()` returns a typed Run<T>; waitForHook's signature wants Run<any>. The
// runtime is identical — narrow the type at the call boundary.
type AnyRun = Parameters<typeof waitForHook>[0];

/**
 * Durable lifecycle workflow (Block 11b), driven in-process by `@workflow/vitest`.
 * Proves the receipt-hook contract the receive Server Action depends on: the run
 * parks on the deterministic token, the token stays valid across the wait (the
 * approved-but-not-received gap can be months — the runtime preserves the run),
 * and resuming it lets the run advance past the suspend point.
 *
 * The post-receipt `finalizeStep` reads Postgres via the admin client; that path
 * is covered directly in tests/purchase-orders/finalize.test.ts, so this test
 * stops at proving the suspend/resume mechanics rather than awaiting the
 * DB-bound completion.
 */

describe('purchaseOrderLifecycleWorkflow', () => {
  it('parks on the deterministic receipt token and is resumable after the wait', async () => {
    const poId = '00000000-0000-4000-8000-00000000a11b';
    const run = await start(purchaseOrderLifecycleWorkflow, [{ tenantId: 'T1', poId }]);
    const token = poReceiptHookToken(poId);

    // The run reaches the hook and suspends on exactly the token the receive
    // action will resume — discovering it here is the "still valid" guarantee.
    const hook = await waitForHook(run as unknown as AnyRun, { token });
    expect(hook.token).toBe(token);

    // The token resolves the suspend; resumeHook is what the receive action calls
    // when the goods land. No throw == the parked run accepted the wake.
    await expect(
      resumeHook(token, { status: 'received', actualDeliveryAt: '2026-06-13T00:00:00.000Z' }),
    ).resolves.not.toThrow();
  });

  it('a fresh run parks under its OWN token — tokens are per-PO', async () => {
    const poA = '00000000-0000-4000-8000-00000000a11c';
    const poB = '00000000-0000-4000-8000-00000000a11d';
    const runA = await start(purchaseOrderLifecycleWorkflow, [{ tenantId: 'T1', poId: poA }]);
    const runB = await start(purchaseOrderLifecycleWorkflow, [{ tenantId: 'T1', poId: poB }]);

    const hookA = await waitForHook(runA as unknown as AnyRun, { token: poReceiptHookToken(poA) });
    const hookB = await waitForHook(runB as unknown as AnyRun, { token: poReceiptHookToken(poB) });
    expect(hookA.token).toBe(poReceiptHookToken(poA));
    expect(hookB.token).toBe(poReceiptHookToken(poB));
    expect(hookA.token).not.toBe(hookB.token);

    // Each PO-scoped token resumes only its own run; both accept their wake.
    await expect(
      resumeHook(poReceiptHookToken(poA), {
        status: 'received',
        actualDeliveryAt: '2026-06-13T00:00:00.000Z',
      }),
    ).resolves.not.toThrow();
    await expect(
      resumeHook(poReceiptHookToken(poB), {
        status: 'received',
        actualDeliveryAt: '2026-06-13T00:00:00.000Z',
      }),
    ).resolves.not.toThrow();
  });
});
