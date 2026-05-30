/**
 * Supabase server client — Server Components, Server Actions, route handlers.
 * Uses cookie-based session (managed by @supabase/ssr). Reads `NEXT_PUBLIC_*`
 * vars from the public env.
 *
 * No JavaScript Proxy wrappers around the client (per vercel-storage skill
 * guidance: Proxy breaks auth libraries that introspect adapter objects).
 */

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { env } from '@/lib/env';

export async function createSupabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component — middleware (proxy.ts) handles refresh.
        }
      },
    },
  });
}
