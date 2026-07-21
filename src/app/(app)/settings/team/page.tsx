import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/bench/PageHeader';
import pageStyles from '@/components/bench/page.module.css';
import { Panel } from '@/components/Panel/Panel';
import type { PendingProvisionRow, TeamMemberRow } from '@/lib/access/provisioning';
import type { RequisitionRequesterMode } from '@/lib/access/requisition-authority';
import { isMemberRole, type MemberRole } from '@/lib/access/roles';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServer } from '@/lib/supabase/server';
import { CreateAccessForm, MemberCard, PendingAccessCard } from './TeamManager';
import styles from './team.module.css';

export const metadata = { title: 'Team access · The Chain' };

export default async function TeamPage() {
  const supabase = await createSupabaseServer();
  const [{ data: claimsData }, { data: userData }] = await Promise.all([
    supabase.auth.getClaims(),
    supabase.auth.getUser(),
  ]);
  const tenantId = claimsData?.claims?.tenant_id as string | undefined;
  const roleValue = claimsData?.claims?.tenant_role as string | undefined;
  const currentUserId = userData.user?.id;
  if (
    !tenantId ||
    !currentUserId ||
    !isMemberRole(roleValue) ||
    !['owner', 'manager'].includes(roleValue)
  ) {
    redirect('/settings');
  }
  const actorRole: MemberRole = roleValue;

  const [
    { data: memberData },
    { data: provisionData },
    { data: locationData },
    { data: assignmentData },
    { data: authorityData },
  ] = await Promise.all([
    supabase
      .from('tenant_members')
      .select('user_id, role, created_at, all_locations')
      .eq('tenant_id', tenantId)
      .order('created_at'),
    supabase
      .from('tenant_access_provisions')
      .select(
        'id, email, proposed_role, created_at, credential_expires_at, requires_password_change, created_auth_user',
      )
      .eq('tenant_id', tenantId)
      .eq('status', 'pending')
      .order('created_at'),
    supabase
      .from('locations')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .order('name'),
    supabase
      .from('tenant_member_locations')
      .select('user_id, location_id')
      .eq('tenant_id', tenantId),
    supabase
      .from('tenant_member_requisition_authority')
      .select('user_id, requester_mode, requester_limit, approver_limit')
      .eq('tenant_id', tenantId),
  ]);

  const locations = (locationData ?? []).map((row) => ({ id: row.id, name: row.name }));
  const assignedByUser = new Map<string, string[]>();
  for (const row of assignmentData ?? []) {
    const current = assignedByUser.get(row.user_id) ?? [];
    current.push(row.location_id);
    assignedByUser.set(row.user_id, current);
  }
  const authorityByUser = new Map((authorityData ?? []).map((row) => [row.user_id, row]));

  const admin = createSupabaseAdmin();
  const members: TeamMemberRow[] = await Promise.all(
    (memberData ?? []).map(async (row) => {
      const { data } = await admin.auth.admin.getUserById(row.user_id);
      const authority = authorityByUser.get(row.user_id);
      return {
        userId: row.user_id,
        email: data.user?.email ?? 'Unknown email',
        role: row.role as MemberRole,
        createdAt: row.created_at,
        isCurrentUser: row.user_id === currentUserId,
        allLocations: row.all_locations,
        locationIds: assignedByUser.get(row.user_id) ?? [],
        requesterMode:
          (authority?.requester_mode as RequisitionRequesterMode | undefined) ??
          'always_require_approval',
        requesterLimit:
          authority?.requester_limit == null ? null : Number(authority.requester_limit),
        approverLimit: authority?.approver_limit == null ? null : Number(authority.approver_limit),
      };
    }),
  );
  const pending = (provisionData ?? []).map(
    (row): PendingProvisionRow => ({
      id: row.id,
      email: row.email,
      role: row.proposed_role as MemberRole,
      createdAt: row.created_at,
      credentialExpiresAt: row.credential_expires_at,
      requiresPasswordChange: row.requires_password_change,
      createdAuthUser: row.created_auth_user,
    }),
  );

  return (
    <div className={pageStyles.stack}>
      <PageHeader eyebrow="Company · people · authority" title="Team access" />
      <Panel prefix="Create" title="Add a person">
        <p className={styles.intro}>
          New accounts receive a one-time temporary password. Existing Chain accounts keep their
          current password.
        </p>
        <CreateAccessForm actorRole={actorRole} />
      </Panel>
      {pending.length ? (
        <section className={styles.grid} aria-label="Pending team access">
          <h2 className={styles.sectionTitle}>Pending access</h2>
          {pending.map((row) => (
            <PendingAccessCard key={row.id} row={row} />
          ))}
        </section>
      ) : null}
      <section className={styles.grid} aria-label="Active team members">
        <h2 className={styles.sectionTitle}>Active team</h2>
        {members.map((row) => (
          <MemberCard key={row.userId} row={row} actorRole={actorRole} locations={locations} />
        ))}
      </section>
    </div>
  );
}
