import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { serverEnv } from '@/lib/env';

export const PROVISIONAL_PASSWORD_PROOF_COOKIE = 'chain_provisional_password_proof';

interface ProofInput {
  userId: string;
  provisionId: string;
  password: string;
}

function digest(input: ProofInput, secret: string): Buffer {
  return createHmac('sha256', secret)
    .update(input.userId)
    .update('\0')
    .update(input.provisionId)
    .update('\0')
    .update(input.password)
    .digest();
}

/**
 * Short-lived, non-reversible proof of the credential used at provisional
 * sign-in. The raw temporary password is never persisted or logged.
 */
export function createProvisionalPasswordProof(input: ProofInput, secret?: string): string {
  return digest(input, secret ?? serverEnv().SUPABASE_SERVICE_ROLE_KEY).toString('base64url');
}

export function matchesProvisionalPasswordProof(
  proof: string,
  input: ProofInput,
  secret?: string,
): boolean {
  let supplied: Buffer;
  try {
    supplied = Buffer.from(proof, 'base64url');
  } catch {
    return false;
  }
  const expected = digest(input, secret ?? serverEnv().SUPABASE_SERVICE_ROLE_KEY);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
