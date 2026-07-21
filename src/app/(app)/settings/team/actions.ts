'use server';

import { revalidatePath } from 'next/cache';
import {
  generateTemporaryPassword,
  mapProvisionError,
  type OneTimeCredential,
  temporaryCredentialExpiry,
} from '@/lib/access/provisioning';
import { isRequisitionRequesterMode } from '@/lib/access/requisition-authority';
import { canManageRole, isMemberRole, type MemberRole } from '@/lib/access/roles';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServer } from '@/lib/supabase/server';

export type TeamActionState =
  | { ok: false; error: string }
  | {
      ok: true;
      message: string;
      credential?: OneTimeCredential;
    }
  | null;

interface Actor {
  supabase: Awaited<ReturnType<typeof createSupabaseServer>>;
  tenantId: string;
  userId: string;
  role: MemberRole;
}

async function actor(): Promise<Actor | null> {
  const supabase = await createSupabaseServer();
  const [{ data: claimsData }, { data: userData }] = await Promise.all([
    supabase.auth.getClaims(),
    supabase.auth.getUser(),
  ]);
  const claims = claimsData?.claims;
  const tenantId = claims?.tenant_id as string | undefined;
  const roleValue = claims?.tenant_role as string | undefined;
  const userId = userData.user?.id;
  if (
    !tenantId ||
    !userId ||
    !isMemberRole(roleValue) ||
    !['owner', 'manager'].includes(roleValue)
  ) {
    return null;
  }
  const { count } = await supabase
    .from('tenant_members')
    .select('tenant_id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('user_id', userId);
  return count ? { supabase, tenantId, userId, role: roleValue } : null;
}

function refreshTeam(): void {
  revalidatePath('/settings');
  revalidatePath('/settings/team');
}

async function authUserForEmail(email: string): Promise<string | null> {
  const admin = createSupabaseAdmin();
  const { data, error } = await admin.rpc('find_auth_user_id_by_email', { p_email: email });
  if (error) throw error;
  return typeof data === 'string' ? data : null;
}

export async function createTeamAccess(
  _prev: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  const roleValue = String(formData.get('role') ?? 'viewer');
  if (!/^\S+@\S+\.\S+$/.test(email)) return { ok: false, error: 'Enter a valid email address.' };
  if (!isMemberRole(roleValue)) return { ok: false, error: 'Choose a valid role.' };

  const auth = await actor();
  if (!auth || !canManageRole(auth.role, roleValue, roleValue)) {
    return { ok: false, error: 'You do not have permission to administer that role.' };
  }

  const admin = createSupabaseAdmin();
  let authUserId: string | null = null;
  let createdAuthUser = false;
  let temporaryPassword: string | null = null;
  try {
    authUserId = await authUserForEmail(email);
    if (!authUserId) {
      temporaryPassword = generateTemporaryPassword();
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: temporaryPassword,
        email_confirm: true,
        app_metadata: { chain_provisional: true },
      });
      if (error || !data.user) {
        // Close a lookup/create race without resetting an existing user's password.
        authUserId = await authUserForEmail(email);
        if (!authUserId) throw error ?? new Error('auth_user_create_failed');
        temporaryPassword = null;
      } else {
        authUserId = data.user.id;
        createdAuthUser = true;
      }
    }

    const expiresAt = createdAuthUser ? temporaryCredentialExpiry() : null;
    const { error } = await auth.supabase.rpc('create_tenant_access_provision', {
      p_tenant: auth.tenantId,
      p_email: email,
      p_auth_user: authUserId,
      p_role: roleValue,
      p_requires_password_change: createdAuthUser,
      p_created_auth_user: createdAuthUser,
      p_credential_expires_at: expiresAt?.toISOString() ?? null,
      p_department: null,
    });
    if (error) {
      return { ok: false, error: mapProvisionError(error.message) };
    }

    refreshTeam();
    if (temporaryPassword && expiresAt) {
      return {
        ok: true,
        message: 'Provisional access created. Copy this password now; it will not be shown again.',
        credential: { email, password: temporaryPassword, expiresAt: expiresAt.toISOString() },
      };
    }
    return {
      ok: true,
      message:
        'This email already has a Chain account. Ask them to sign in with their current password to activate this company.',
    };
  } catch (error) {
    console.error('team access creation failed', error);
    return { ok: false, error: 'We could not create access. Please try again.' };
  }
}

export async function rotateTemporaryPassword(
  _prev: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const provisionId = String(formData.get('provision_id') ?? '');
  const auth = await actor();
  if (!auth || !provisionId) return { ok: false, error: 'That access record is unavailable.' };
  const { data: provision } = await auth.supabase
    .from('tenant_access_provisions')
    .select('email')
    .eq('tenant_id', auth.tenantId)
    .eq('id', provisionId)
    .eq('status', 'pending')
    .maybeSingle();
  if (!provision) return { ok: false, error: 'That access record is unavailable.' };
  const expiresAt = temporaryCredentialExpiry();
  const { data: authUserId, error } = await auth.supabase.rpc('rotate_tenant_access_provision', {
    p_tenant: auth.tenantId,
    p_provision: provisionId,
    p_credential_expires_at: expiresAt.toISOString(),
  });
  if (error || typeof authUserId !== 'string') {
    return { ok: false, error: mapProvisionError(error?.message ?? 'not_found') };
  }
  const password = generateTemporaryPassword();
  const admin = createSupabaseAdmin();
  const { error: updateError } = await admin.auth.admin.updateUserById(authUserId, { password });
  if (updateError) return { ok: false, error: 'We could not rotate that password. Try again.' };
  refreshTeam();
  return {
    ok: true,
    message: 'Temporary password replaced. Copy the new password now.',
    credential: { email: provision.email, password, expiresAt: expiresAt.toISOString() },
  };
}

export async function revokePendingAccess(
  _prev: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const provisionId = String(formData.get('provision_id') ?? '');
  const auth = await actor();
  if (!auth || !provisionId) return { ok: false, error: 'That access record is unavailable.' };
  const { data, error } = await auth.supabase.rpc('revoke_tenant_access_provision', {
    p_tenant: auth.tenantId,
    p_provision: provisionId,
  });
  if (error) return { ok: false, error: mapProvisionError(error.message) };

  const result = Array.isArray(data) ? data[0] : null;
  // Do not delete the Auth identity here. Auth and Postgres cannot share the
  // revocation transaction; another tenant may have provisioned this same user
  // after our guarded check. A dormant identity has no tenant claims or data
  // access, while deleting a now-shared identity would lock out a real member.
  refreshTeam();
  return {
    ok: true,
    message: result?.out_revoked ? 'Pending access revoked.' : 'Access was already closed.',
  };
}

function optionalAmount(value: FormDataEntryValue | null): number | null | undefined {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const amount = Number(text);
  return Number.isFinite(amount) && amount >= 0 ? amount : undefined;
}

export async function setMemberRequisitionAuthority(
  _prev: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const memberId = String(formData.get('member_id') ?? '');
  const modeValue = String(formData.get('requester_mode') ?? '');
  const requesterLimit = optionalAmount(formData.get('requester_limit'));
  const approverLimit = optionalAmount(formData.get('approver_limit'));
  const auth = await actor();
  if (auth?.role !== 'owner' || !memberId || !isRequisitionRequesterMode(modeValue)) {
    return { ok: false, error: 'Only an owner can change requisition authority.' };
  }
  if (requesterLimit === undefined || approverLimit === undefined) {
    return { ok: false, error: 'Spend limits must be zero or greater.' };
  }
  if (modeValue === 'auto_approve_to_limit' && requesterLimit == null) {
    return { ok: false, error: 'Enter the amount this person may request automatically.' };
  }

  const { error } = await auth.supabase.rpc('set_member_requisition_authority', {
    p_tenant: auth.tenantId,
    p_member: memberId,
    p_requester_mode: modeValue,
    p_requester_limit: modeValue === 'auto_approve_to_limit' ? requesterLimit : null,
    p_approver_limit: approverLimit,
  });
  if (error) {
    if (/authority_forbidden/i.test(error.message)) {
      return { ok: false, error: 'Only an owner can change requisition authority.' };
    }
    return { ok: false, error: 'We could not save that requisition authority.' };
  }
  refreshTeam();
  return { ok: true, message: 'Requisition authority saved.' };
}

export async function changeMemberRole(
  _prev: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const memberId = String(formData.get('member_id') ?? '');
  const roleValue = String(formData.get('role') ?? '');
  const auth = await actor();
  if (!auth || !memberId || !isMemberRole(roleValue))
    return { ok: false, error: 'That role change is unavailable.' };
  const { error } = await auth.supabase.rpc('change_tenant_member_role', {
    p_tenant: auth.tenantId,
    p_member: memberId,
    p_role: roleValue,
  });
  if (error) return { ok: false, error: mapProvisionError(error.message) };
  refreshTeam();
  return { ok: true, message: 'Role updated.' };
}

export async function setMemberLocationAccess(
  _prev: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const memberId = String(formData.get('member_id') ?? '');
  const scope = String(formData.get('location_scope') ?? 'all');
  const locationIds = formData.getAll('location_id').map(String).filter(Boolean);
  const auth = await actor();
  if (!auth || !memberId) return { ok: false, error: 'That member is unavailable.' };
  if (scope === 'selected' && locationIds.length === 0) {
    return { ok: false, error: 'Select at least one active location.' };
  }
  const { error } = await auth.supabase.rpc('set_tenant_member_location_access', {
    p_tenant: auth.tenantId,
    p_member: memberId,
    p_all_locations: scope === 'all',
    p_location_ids: locationIds,
  });
  if (error) return { ok: false, error: mapProvisionError(error.message) };
  refreshTeam();
  return { ok: true, message: 'Location access updated.' };
}

export async function removeMember(
  _prev: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const memberId = String(formData.get('member_id') ?? '');
  const auth = await actor();
  if (!auth || !memberId) return { ok: false, error: 'That member is unavailable.' };
  const { error } = await auth.supabase.rpc('remove_tenant_member', {
    p_tenant: auth.tenantId,
    p_member: memberId,
  });
  if (error) return { ok: false, error: mapProvisionError(error.message) };
  refreshTeam();
  return { ok: true, message: 'Team access removed.' };
}
