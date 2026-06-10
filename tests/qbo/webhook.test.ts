import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseEventRealmIds, verifyIntuitSignature } from '@/lib/qbo/webhook';

const TOKEN = 'whvt_test_token';
const sign = (body: string, token = TOKEN): string =>
  createHmac('sha256', token).update(body, 'utf8').digest('base64');

const PAYLOAD = JSON.stringify({
  eventNotifications: [
    {
      realmId: '9341454816836171',
      dataChangeEvent: { entities: [{ name: 'Item', id: '42', operation: 'Update' }] },
    },
  ],
});

describe('verifyIntuitSignature', () => {
  it('accepts a signature computed with the verifier token over the raw body', () => {
    expect(verifyIntuitSignature(PAYLOAD, sign(PAYLOAD), TOKEN)).toBe(true);
  });

  it('rejects a signature from a different token', () => {
    expect(verifyIntuitSignature(PAYLOAD, sign(PAYLOAD, 'other_token'), TOKEN)).toBe(false);
  });

  it('rejects a tampered body', () => {
    const sig = sign(PAYLOAD);
    expect(verifyIntuitSignature(`${PAYLOAD} `, sig, TOKEN)).toBe(false);
  });

  it('rejects a missing signature header', () => {
    expect(verifyIntuitSignature(PAYLOAD, null, TOKEN)).toBe(false);
    expect(verifyIntuitSignature(PAYLOAD, '', TOKEN)).toBe(false);
  });

  it('rejects when no verifier token is configured (refuse-by-default)', () => {
    expect(verifyIntuitSignature(PAYLOAD, sign(PAYLOAD), undefined)).toBe(false);
    expect(verifyIntuitSignature(PAYLOAD, sign(PAYLOAD), '')).toBe(false);
  });

  it('rejects a wrong-length signature without throwing', () => {
    expect(verifyIntuitSignature(PAYLOAD, 'not-the-right-length', TOKEN)).toBe(false);
  });
});

describe('parseEventRealmIds', () => {
  it('extracts a single realmId', () => {
    expect(parseEventRealmIds(JSON.parse(PAYLOAD))).toEqual(['9341454816836171']);
  });

  it('coalesces duplicate realmIds from a multi-entity burst', () => {
    const body = {
      eventNotifications: [
        { realmId: '111', dataChangeEvent: {} },
        { realmId: '111', dataChangeEvent: {} },
        { realmId: '222', dataChangeEvent: {} },
      ],
    };
    expect(parseEventRealmIds(body)).toEqual(['111', '222']);
  });

  it('coerces a numeric realmId to a string', () => {
    expect(parseEventRealmIds({ eventNotifications: [{ realmId: 333 }] })).toEqual(['333']);
  });

  it('returns [] for an empty or malformed payload', () => {
    expect(parseEventRealmIds({ eventNotifications: [] })).toEqual([]);
    expect(parseEventRealmIds({})).toEqual([]);
    expect(parseEventRealmIds(null)).toEqual([]);
    expect(parseEventRealmIds('nope')).toEqual([]);
    expect(parseEventRealmIds({ eventNotifications: [{ foo: 'bar' }] })).toEqual([]);
  });
});
