import type { ReactNode } from 'react';
import { PageHeader } from '@/components/bench/PageHeader';
import pageStyles from '@/components/bench/page.module.css';
import { Panel } from '@/components/Panel/Panel';
import { isMemberRole, roleCan } from '@/lib/access';
import { qboEnv } from '@/lib/env';
import { getQboStatus } from '@/lib/qbo/connection';
import { createSupabaseServer } from '@/lib/supabase/server';
import { ConnectPanel } from './ConnectPanel';

export const metadata = { title: 'QuickBooks Online · The Chain' };

/**
 * QuickBooks Online connect screen (Block 6). Server shell: reads the tenant's
 * connection status + the OAuth callback's status flag, hands them to the
 * interactive `ConnectPanel`.
 */
export default async function QuickBooksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}): Promise<ReactNode> {
  const sp = await searchParams;
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getClaims();
  const tenantId = data?.claims?.tenant_id as string | undefined;
  const roleClaim = data?.claims?.tenant_role;
  if (!isMemberRole(roleClaim) || !roleCan(roleClaim, 'integrations.manage')) {
    return (
      <div className={pageStyles.stack}>
        <PageHeader eyebrow="Integrations · native two-way sync" title="QuickBooks Online" />
        <Panel prefix="Restricted" title="Connection access is limited">
          <p>Only owners and managers can connect or inspect QuickBooks.</p>
        </Panel>
      </div>
    );
  }

  const status = tenantId ? await getQboStatus(supabase, tenantId) : { connected: false };

  // Conflicts the incremental sync queued for review (Wave 6.3-B). RLS-scoped.
  const { count: pendingConflicts } = await supabase
    .from('sync_conflicts')
    .select('id', { count: 'exact', head: true })
    .eq('applied_resolution', 'pending');

  let environment = 'sandbox';
  let configured = false;
  try {
    environment = qboEnv().QBO_ENVIRONMENT;
    configured = true;
  } catch {
    // QBO env not set on this deploy — ConnectPanel renders an unavailable state
    // instead of a Connect button that would throw on click.
  }

  const banner = sp.connected ? 'connected' : sp.qbo_error ? `error:${sp.qbo_error}` : null;

  return (
    <div className={pageStyles.stack}>
      <PageHeader eyebrow="Integrations · native two-way sync" title="QuickBooks Online" />
      <ConnectPanel
        connected={status.connected}
        configured={configured}
        realmId={status.realmId}
        lastSyncedAt={status.lastSyncedAt ?? null}
        environment={environment}
        banner={banner}
        pendingConflicts={pendingConflicts ?? 0}
      />
    </div>
  );
}
