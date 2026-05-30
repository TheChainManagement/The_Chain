/**
 * Supabase browser client — Client Components only.
 * Public anon key + URL come from NEXT_PUBLIC_* env (safe on the client).
 */

import { createBrowserClient } from '@supabase/ssr';
import { env } from '@/lib/env';

export function createSupabaseBrowser() {
  return createBrowserClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
}
