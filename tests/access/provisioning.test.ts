import { describe, expect, it } from 'vitest';
import {
  generateTemporaryPassword,
  mapProvisionError,
  temporaryCredentialExpiry,
} from '@/lib/access/provisioning';

describe('temporary credentials', () => {
  it('generates 20-character passwords with every required character class', () => {
    const generated = new Set(Array.from({ length: 50 }, () => generateTemporaryPassword()));
    expect(generated.size).toBe(50);
    for (const password of generated) {
      expect(password).toHaveLength(20);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[0-9]/);
      expect(password).toMatch(/[!@#$%*\-_+=]/);
    }
  });

  it('expires temporary credentials 24 hours after issuance', () => {
    const from = new Date('2026-07-17T12:00:00.000Z');
    expect(temporaryCredentialExpiry(from).toISOString()).toBe('2026-07-18T12:00:00.000Z');
  });

  it('maps guarded database failures to useful copy', () => {
    expect(mapProvisionError('provision_already_pending')).toContain('already pending');
    expect(mapProvisionError('privileged_role_management_forbidden')).toContain('permission');
    expect(mapProvisionError('temporary_credential_expired')).toContain('expired');
  });
});
