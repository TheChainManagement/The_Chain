/**
 * Intuit webhook verification + parsing (Block 6, Wave 6.3-D) — pure, no I/O.
 *
 * Intuit posts a change notification to a single configured endpoint whenever
 * tracked QBO entities change. Unlike the 15-minute cron, this fires near-real-time.
 * Every callback MUST be signature-verified before any processing
 * (`FEATURES.md:289`): Intuit signs the raw request body with the app's webhook
 * verifier token, HMAC-SHA256, and sends it base64 in the `intuit-signature` header.
 *
 * The route handler reads the RAW body (signature is over bytes, not re-serialized
 * JSON), verifies it here, then maps each notification's `realmId` to a connection
 * and fans out the same durable incremental sync the cron runs.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export const INTUIT_SIGNATURE_HEADER = 'intuit-signature';

/**
 * Verify Intuit's `intuit-signature` over the raw request body.
 *
 * Returns false (never throws) on any malformed input so the caller can reject
 * with a flat 401. Constant-time comparison; a length mismatch short-circuits to
 * false before the timing-safe compare (which requires equal-length buffers).
 */
export function verifyIntuitSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  verifierToken: string | null | undefined,
): boolean {
  if (!signatureHeader || !verifierToken) return false;

  const expected = createHmac('sha256', verifierToken).update(rawBody, 'utf8').digest();
  let received: Buffer;
  try {
    received = Buffer.from(signatureHeader, 'base64');
  } catch {
    return false;
  }
  if (received.length !== expected.length) return false;
  return timingSafeEqual(received, expected);
}

interface EventNotification {
  realmId?: unknown;
}

/**
 * Pull the distinct `realmId`s out of an Intuit webhook payload. Each
 * notification names the QBO company (realm) whose data changed; we coalesce
 * duplicates so a multi-entity burst triggers at most one sync per realm.
 * Tolerant of a malformed body — returns `[]` rather than throwing.
 */
export function parseEventRealmIds(body: unknown): string[] {
  if (!body || typeof body !== 'object') return [];
  const notifications = (body as { eventNotifications?: unknown }).eventNotifications;
  if (!Array.isArray(notifications)) return [];

  const realmIds = new Set<string>();
  for (const n of notifications as EventNotification[]) {
    const realmId = n?.realmId;
    if (typeof realmId === 'string' && realmId.length > 0) realmIds.add(realmId);
    else if (typeof realmId === 'number') realmIds.add(String(realmId));
  }
  return [...realmIds];
}
