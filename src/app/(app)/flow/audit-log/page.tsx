import type { ReactNode } from 'react';
import { PageHeader } from '@/components/bench/PageHeader';
import pageStyles from '@/components/bench/page.module.css';
import { Panel } from '@/components/Panel/Panel';
import {
  getRetentionTier,
  hasOlderHistory,
  listAuditEntityTypes,
  listAuditEvents,
} from '@/lib/audit/queries';
import { canReadAudit, tierWindowCutoffIso, tierWindowLabel } from '@/lib/audit/transform';
import { createSupabaseServer } from '@/lib/supabase/server';
import { AuditChain } from './AuditChain';
import styles from './audit-log.module.css';

export const metadata = { title: 'Audit Log · The Chain' };

/**
 * Audit-log viewer (Block 14a). Server shell: reads the tenant's retention tier
 * to fix the hot window, then the RLS-scoped events within it, and hands the
 * stream to the vertical chain-of-events. The role gate is explicit so a
 * non-privileged member gets a clear "restricted" surface, not an empty list.
 */
export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string }>;
}): Promise<ReactNode> {
  const { entity } = await searchParams;
  const supabase = await createSupabaseServer();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  const role = claims?.tenant_role as string | undefined;
  const tenantId = claims?.tenant_id as string | undefined;
  const userId = (claims?.sub as string | undefined) ?? null;

  if (!tenantId || !canReadAudit(role)) {
    return (
      <div className={pageStyles.stack}>
        <PageHeader eyebrow="Flow · audit" title="Audit Log" />
        <Panel prefix="Restricted" title="Visible to owners, managers, and finance">
          <p className={styles.restricted}>
            The audit trail records every change to your catalog, orders, and stock. Access is
            limited to owner, manager, and finance roles.
          </p>
        </Panel>
      </div>
    );
  }

  const nowMs = Date.now();
  const tier = await getRetentionTier(tenantId);
  const cutoffIso = tierWindowCutoffIso(tier, nowMs);
  const entityType = entity && entity !== 'all' ? entity : undefined;

  const [{ events, capped }, entityTypes, olderExists] = await Promise.all([
    listAuditEvents(supabase, { cutoffIso, entityType, currentUserId: userId, nowMs }),
    listAuditEntityTypes(supabase, cutoffIso),
    // Scope the older-history check to the active filter so a filtered view never
    // claims gated history that belongs to a different record type.
    hasOlderHistory(supabase, cutoffIso, entityType),
  ]);

  return (
    <div className={pageStyles.stack}>
      <PageHeader eyebrow="Flow · audit" title="Audit Log" />
      <AuditChain
        events={events}
        entityTypes={entityTypes}
        activeEntity={entityType ?? 'all'}
        windowLabel={tierWindowLabel(tier)}
        olderExists={olderExists}
        capped={capped}
        tier={tier}
      />
    </div>
  );
}
