/**
 * Source adapter error taxonomy.
 *
 * - `RetryableError` — transient failure (network, 429, 5xx). Workflow DevKit
 *   retries with backoff; optional `retryAfter` hint is honored when present.
 * - `FatalError` — permanent failure (4xx auth, schema mismatch, validation).
 *   Workflow routes the record to `sync_failures` with `dead_letter=false`
 *   initially; after the configured retry budget, `dead_letter` flips.
 *
 * Adapters throw these. Steps wrap their I/O so the orchestrator workflow
 * sees the right error class.
 */

export class RetryableError extends Error {
  readonly retryAfter?: string;
  constructor(message: string, opts?: { retryAfter?: string }) {
    super(message);
    this.name = 'RetryableError';
    this.retryAfter = opts?.retryAfter;
  }
}

export class FatalError extends Error {
  readonly code?: string;
  constructor(message: string, opts?: { code?: string }) {
    super(message);
    this.name = 'FatalError';
    this.code = opts?.code;
  }
}
