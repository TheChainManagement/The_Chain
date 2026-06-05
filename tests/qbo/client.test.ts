import { describe, expect, it } from 'vitest';
import { QboClient } from '@/lib/qbo/client';
import { FatalError, RetryableError } from '@/lib/source-adapter';
import type { QboRequest, QboResponse, QboTransport } from '@/lib/qbo/transport';

/** A transport that returns one canned response, capturing the request it saw. */
class CannedTransport implements QboTransport {
  last?: QboRequest;
  constructor(private readonly response: QboResponse) {}
  async request(req: QboRequest): Promise<QboResponse> {
    this.last = req;
    return this.response;
  }
}

function client(response: QboResponse): { client: QboClient; transport: CannedTransport } {
  const transport = new CannedTransport(response);
  return {
    client: new QboClient({ realmId: '900', environment: 'sandbox' }, transport),
    transport,
  };
}

describe('QboClient.query', () => {
  it('returns the body on 200 and targets the sandbox host + realm', async () => {
    const { client: c, transport } = client({
      status: 200,
      headers: {},
      body: { QueryResponse: { Item: [{ Id: '1' }] } },
    });
    const res = await c.query('SELECT * FROM Item');
    expect(res.QueryResponse?.Item).toHaveLength(1);
    expect(transport.last?.url).toContain('https://sandbox-quickbooks.api.intuit.com/v3/company/900/query');
    expect(transport.last?.url).toContain('minorversion=');
  });

  it('throws RetryableError with retryAfter on 429', async () => {
    const { client: c } = client({ status: 429, headers: { 'retry-after': '30' }, body: {} });
    await expect(c.query('SELECT * FROM Item')).rejects.toMatchObject({
      name: 'RetryableError',
      retryAfter: '30',
    });
    await expect(c.query('SELECT * FROM Item')).rejects.toBeInstanceOf(RetryableError);
  });

  it('throws RetryableError on a 5xx server fault', async () => {
    const { client: c } = client({ status: 503, headers: {}, body: {} });
    await expect(c.query('SELECT * FROM Item')).rejects.toBeInstanceOf(RetryableError);
  });

  it('throws FatalError(code=auth) on 401', async () => {
    const { client: c } = client({ status: 401, headers: {}, body: {} });
    await expect(c.query('SELECT * FROM Item')).rejects.toMatchObject({ name: 'FatalError', code: 'auth' });
  });

  it('throws FatalError carrying Intuit fault detail on a 400', async () => {
    const { client: c } = client({
      status: 400,
      headers: {},
      body: { Fault: { Error: [{ Message: 'Invalid', Detail: 'Bad query syntax' }] } },
    });
    await expect(c.query('SELECT bad')).rejects.toMatchObject({ name: 'FatalError' });
    await expect(c.query('SELECT bad')).rejects.toThrow(/Bad query syntax/);
  });
});

describe('QboClient.createPurchaseOrder', () => {
  it('returns the created PurchaseOrder on 200', async () => {
    const { client: c, transport } = client({
      status: 200,
      headers: {},
      body: { PurchaseOrder: { Id: '301', SyncToken: '0' } },
    });
    const po = await c.createPurchaseOrder({ VendorRef: { value: '56' } });
    expect(po.Id).toBe('301');
    expect(transport.last?.method).toBe('POST');
    expect(transport.last?.url).toContain('/purchaseorder');
  });

  it('throws FatalError when QBO returns an empty body', async () => {
    const { client: c } = client({ status: 200, headers: {}, body: {} });
    await expect(c.createPurchaseOrder({})).rejects.toMatchObject({
      name: 'FatalError',
      code: 'empty_response',
    });
  });
});
