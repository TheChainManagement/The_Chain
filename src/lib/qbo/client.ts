/**
 * QboClient — query + write layer over the transport seam.
 *
 * Owns two responsibilities and nothing else:
 *   1. Build Intuit v3 requests (the Query API + the PurchaseOrder create).
 *   2. Translate HTTP outcomes into the adapter error taxonomy: a 429 or 5xx
 *      becomes a `RetryableError` (Workflow DevKit retries with backoff, honoring
 *      `retryAfter`); an auth or other 4xx becomes a `FatalError` (the record is
 *      dead-lettered, not retried forever).
 *
 * No QBO→canonical mapping lives here (that is `map.ts`); no pagination policy
 * lives here (that is the adapter). This is the wire, kept thin + testable.
 */

import { FatalError, RetryableError } from '@/lib/source-adapter';
import type { QboTransport } from './transport';
import type {
  QboEntityResponse,
  QboFaultResponse,
  QboPurchaseOrder,
  QboQueryResponse,
} from './types';

export type QboEnvironment = 'sandbox' | 'production';

export interface QboConnection {
  realmId: string;
  environment: QboEnvironment;
}

/** Intuit minor version pinned so response shapes don't drift under us. */
const MINOR_VERSION = '73';

const BASE_URL: Record<QboEnvironment, string> = {
  sandbox: 'https://sandbox-quickbooks.api.intuit.com',
  production: 'https://quickbooks.api.intuit.com',
};

export class QboClient {
  constructor(
    private readonly connection: QboConnection,
    private readonly transport: QboTransport,
  ) {}

  private get root(): string {
    return `${BASE_URL[this.connection.environment]}/v3/company/${this.connection.realmId}`;
  }

  /** Run a QBO SQL-like query statement, returning the raw query envelope. */
  async query(statement: string): Promise<QboQueryResponse> {
    const url = `${this.root}/query?query=${encodeURIComponent(statement)}&minorversion=${MINOR_VERSION}`;
    const res = await this.transport.request({ method: 'GET', url });
    return this.unwrap(res.status, res.headers, res.body) as QboQueryResponse;
  }

  /** Create a PurchaseOrder in QBO. Idempotency (round-trip lookup) is the adapter's job. */
  async createPurchaseOrder(po: Record<string, unknown>): Promise<QboPurchaseOrder> {
    const url = `${this.root}/purchaseorder?minorversion=${MINOR_VERSION}`;
    const res = await this.transport.request({ method: 'POST', url, body: po });
    const body = this.unwrap(res.status, res.headers, res.body) as QboEntityResponse;
    if (!body.PurchaseOrder) {
      throw new FatalError('QBO accepted the request but returned no PurchaseOrder.', {
        code: 'empty_response',
      });
    }
    return body.PurchaseOrder;
  }

  /**
   * Map an HTTP outcome to the adapter error taxonomy, or return the body on 2xx.
   *   - 429 → RetryableError with `retryAfter` from the response header.
   *   - 5xx → RetryableError (transient server fault).
   *   - 401/403 → FatalError(code='auth') so the workflow surfaces a reconnect alert.
   *   - other 4xx → FatalError carrying Intuit's fault detail (never the token).
   */
  private unwrap(status: number, headers: Record<string, string>, body: unknown): unknown {
    if (status >= 200 && status < 300) return body;

    if (status === 429) {
      throw new RetryableError('QuickBooks rate limit hit (429).', {
        retryAfter: headers['retry-after'],
      });
    }
    if (status >= 500) {
      throw new RetryableError(`QuickBooks server error (${status}).`);
    }
    if (status === 401 || status === 403) {
      throw new FatalError('QuickBooks rejected the access token. Reconnect required.', {
        code: 'auth',
      });
    }

    throw new FatalError(faultMessage(body, status), { code: 'qbo_request' });
  }
}

/** Extract Intuit's human-readable fault detail without leaking the request. */
function faultMessage(body: unknown, status: number): string {
  const fault = (body as QboFaultResponse | null)?.Fault?.Error?.[0];
  const detail = fault?.Detail ?? fault?.Message;
  return detail
    ? `QuickBooks request failed (${status}): ${detail}`
    : `QuickBooks request failed (${status}).`;
}
