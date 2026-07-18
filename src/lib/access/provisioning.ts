import { randomInt } from 'node:crypto';
import type { MemberRole } from './roles';

export const TEMPORARY_CREDENTIAL_HOURS = 24;

export type ProvisionStatus = 'pending' | 'activated' | 'revoked' | 'expired';

export interface TeamMemberRow {
  userId: string;
  email: string;
  role: MemberRole;
  createdAt: string;
  isCurrentUser: boolean;
  allLocations: boolean;
  locationIds: string[];
}

export interface PendingProvisionRow {
  id: string;
  email: string;
  role: MemberRole;
  createdAt: string;
  credentialExpiresAt: string | null;
  requiresPasswordChange: boolean;
  createdAuthUser: boolean;
}

export interface OneTimeCredential {
  email: string;
  password: string;
  expiresAt: string;
}

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%*-_+=';
const ALL = `${UPPER}${LOWER}${DIGITS}${SYMBOLS}`;

function pick(chars: string): string {
  return chars[randomInt(chars.length)] ?? '';
}

/** Cryptographically generated and deliberately free of ambiguous glyphs. */
export function generateTemporaryPassword(): string {
  const required = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SYMBOLS)];
  const rest = Array.from({ length: 16 }, () => pick(ALL));
  const value = [...required, ...rest];
  for (let index = value.length - 1; index > 0; index -= 1) {
    const swap = randomInt(index + 1);
    [value[index], value[swap]] = [value[swap] ?? '', value[index] ?? ''];
  }
  return value.join('');
}

export function temporaryCredentialExpiry(from = new Date()): Date {
  return new Date(from.getTime() + TEMPORARY_CREDENTIAL_HOURS * 60 * 60 * 1000);
}

export function mapProvisionError(message: string): string {
  if (/already_pending|duplicate key/i.test(message))
    return 'Access is already pending for that email.';
  if (/member_already_exists/i.test(message))
    return 'That person already has access to this company.';
  if (/privileged_role|management_forbidden/i.test(message))
    return 'You do not have permission to administer that role.';
  if (/last_owner_required/i.test(message)) return 'Every company must keep at least one owner.';
  if (/self_role_change|self_removal/i.test(message))
    return 'You cannot change or remove your own access.';
  if (/self_location_change/i.test(message)) return 'You cannot change your own location access.';
  if (/location_assignment_required|final_location_assignment/i.test(message))
    return 'Scoped access must keep at least one active location.';
  if (/location_has_final_member_assignment/i.test(message))
    return 'Reassign scoped members before archiving their final location.';
  if (/active_location_not_found/i.test(message))
    return 'One of those locations is no longer active.';
  if (/not_rotatable/i.test(message))
    return 'This account does not use a temporary password, or it is no longer pending.';
  if (/temporary_credential_expired/i.test(message))
    return 'That temporary password expired. Ask an owner or manager to create a new one.';
  if (/password_replacement_required/i.test(message))
    return 'Replace the temporary password before activating access.';
  if (/not_found/i.test(message)) return 'That access record is no longer available.';
  return 'We could not update team access. Please try again.';
}
