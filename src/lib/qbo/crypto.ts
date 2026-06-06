import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { qboEnv } from '@/lib/env';

/**
 * App-side AES-256-GCM for QBO OAuth tokens at rest (Block 6 Wave 6.2).
 *
 * `source_connections.encrypted_credentials` is bytea; we store the base64 of
 * `iv | authTag | ciphertext`. The key is `QBO_TOKEN_ENC_KEY` (base64, 32 bytes),
 * server-only. GCM gives us tamper detection (a flipped byte fails `final()`),
 * so a corrupted/forged blob throws rather than silently decrypting to garbage.
 *
 * pgsodium is deprecated on PG15+ Supabase; this app-side scheme is the
 * encryption-at-rest the init migration's note deferred to "when QBO OAuth lands".
 */

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

function key(): Buffer {
  const k = Buffer.from(qboEnv().QBO_TOKEN_ENC_KEY, 'base64');
  if (k.length !== 32) {
    throw new Error('QBO_TOKEN_ENC_KEY must decode to 32 bytes (base64-encoded).');
  }
  return k;
}

/** Encrypt a JSON-serializable value → base64(iv | tag | ciphertext). */
export function encryptJson(value: unknown): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key(), iv);
  const pt = Buffer.from(JSON.stringify(value), 'utf8');
  const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}

/** Decrypt a base64(iv | tag | ciphertext) blob. Throws on tamper or wrong key. */
export function decryptJson<T>(blob: string): T {
  const buf = Buffer.from(blob, 'base64');
  if (buf.length < IV_LEN + TAG_LEN) {
    throw new Error('Encrypted credential blob is too short to be valid.');
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key(), iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return JSON.parse(pt.toString('utf8')) as T;
}
