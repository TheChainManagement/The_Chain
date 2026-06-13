/**
 * The deterministic hook token that binds a PO's durable lifecycle run to the
 * receive Server Action (Block 11b). `purchaseOrderLifecycleWorkflow` parks on
 * `createHook({ token })` after approving the order; the receive action calls
 * `resumeHook(token, …)` to advance it. Both sides MUST derive the token the
 * same way, so it lives here — pure, no I/O, importable from a workflow step,
 * an action, and a test alike.
 */
export function poReceiptHookToken(poId: string): string {
  return `po-${poId}-receipt`;
}
