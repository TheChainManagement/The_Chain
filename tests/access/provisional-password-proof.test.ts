import { describe, expect, it } from 'vitest';
import {
  createProvisionalPasswordProof,
  matchesProvisionalPasswordProof,
} from '@/lib/access/provisional-password-proof';

describe('provisional password proof', () => {
  const secret = 'test-service-role-secret';

  it('recognizes the exact temporary password without storing it in the proof', () => {
    const input = { userId: 'user-1', provisionId: 'provision-1', password: 'Temp!234' };
    const proof = createProvisionalPasswordProof(input, secret);
    expect(proof).not.toContain('Temp!234');
    expect(matchesProvisionalPasswordProof(proof, input, secret)).toBe(true);
  });

  it('rejects a replacement password and proof replay for another provision', () => {
    const proof = createProvisionalPasswordProof(
      { userId: 'user-1', provisionId: 'provision-1', password: 'Temp!234' },
      secret,
    );
    expect(
      matchesProvisionalPasswordProof(
        proof,
        { userId: 'user-1', provisionId: 'provision-1', password: 'Different!567' },
        secret,
      ),
    ).toBe(false);
    expect(
      matchesProvisionalPasswordProof(
        proof,
        { userId: 'user-1', provisionId: 'provision-2', password: 'Temp!234' },
        secret,
      ),
    ).toBe(false);
  });
});
