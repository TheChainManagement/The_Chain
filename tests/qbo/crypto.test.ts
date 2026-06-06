import { describe, expect, it } from 'vitest';
import { decryptJson, encryptJson } from '@/lib/qbo/crypto';

/**
 * Requires QBO_TOKEN_ENC_KEY in the env (loaded from .env.local by tests/setup.ts).
 */
describe('qbo crypto — AES-256-GCM token encryption', () => {
  const creds = {
    accessToken: 'access-abc',
    refreshToken: 'refresh-xyz',
    expiresIn: 3600,
    refreshExpiresIn: 8_726_400,
    obtainedAt: '2026-06-05T00:00:00.000Z',
    realmId: '9341454816836171',
  };

  it('round-trips a credentials object', () => {
    const blob = encryptJson(creds);
    expect(typeof blob).toBe('string');
    expect(blob).not.toContain('access-abc'); // ciphertext, not plaintext
    expect(decryptJson(blob)).toEqual(creds);
  });

  it('produces a fresh IV each time (ciphertext differs for the same input)', () => {
    expect(encryptJson(creds)).not.toBe(encryptJson(creds));
  });

  it('rejects a tampered blob (GCM auth tag fails)', () => {
    const buf = Buffer.from(encryptJson(creds), 'base64');
    buf[buf.length - 1] = (buf[buf.length - 1] ?? 0) ^ 0xff; // flip a ciphertext byte
    expect(() => decryptJson(buf.toString('base64'))).toThrow();
  });

  it('rejects a too-short blob', () => {
    expect(() => decryptJson(Buffer.from('short').toString('base64'))).toThrow();
  });
});
