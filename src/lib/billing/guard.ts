import 'server-only';
import { redirect } from 'next/navigation';
import { createSupabaseServer } from '@/lib/supabase/server';

/**
 * Billing auth guard (Block 16). The billing entrypoints live OUTSIDE the (app)
 * bench, so they don't inherit BenchGate's checks — they must replicate them, and
 * for a money path the bar is the same as the bench: a verified user AND a real,
 * current membership in the JWT's tenant (a stale token for a removed member must
 * not reach checkout/portal). Mirrors BenchGate exactly.
 */
export async function requireMember(): Promise<{
  userId: string;
  email: string | null;
  tenantId: string;
}> {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/signin');

  const { data: claims } = await supabase.auth.getClaims();
  const tenantId = claims?.claims?.tenant_id as string | undefined;
  if (!tenantId) redirect('/signin');

  const { count } = await supabase
    .from('tenant_members')
    .select('tenant_id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('tenant_id', tenantId);
  if (!count || count < 1) redirect('/signin');

  return { userId: user.id, email: user.email ?? null, tenantId };
}
