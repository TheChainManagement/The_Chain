/**
 * Supabase service-role client — the SYSTEM writer.
 *
 * Bypasses RLS, so it is used ONLY for tables marked "system mutate" in the RLS
 * matrix (sync_runs, sync_failures) where authenticated members have select-only
 * policies. Every write through this client MUST set `tenant_id` explicitly to a
 * tenant the caller was already verified to belong to — there is no RLS net here.
 *
 * Never import this from a client component. Tenant-scoped reads/writes stay on
 * the RLS client (`createSupabaseServer`).
 */

import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env, serverEnv } from '@/lib/env';

export function createSupabaseAdmin(): SupabaseClient {
  return createClient(env.SUPABASE_URL, serverEnv().SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
