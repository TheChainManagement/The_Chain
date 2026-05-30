/**
 * Session refresh + stale-token-generation rejection.
 * Called from `src/proxy.ts` (Next 16 renamed middleware → proxy).
 *
 * Two responsibilities:
 *   1. Refresh the Supabase session cookie when it's expired.
 *   2. If the JWT carries token_generation < tenants.token_generation,
 *      sign the user out and redirect to /signin?stale=1.
 *      (This closes the stale-claim hole when a role changes or a member
 *      is removed mid-session, per SYSTEM_DESIGN.md §Auth threat model.)
 */

import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/env';

const STALE_REDIRECT_PATH = '/signin?stale=1';

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Refresh session if expired.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Stale token_generation check via Postgres helper.
  if (user) {
    const { data: stale } = await supabase.rpc('is_token_stale');
    if (stale === true) {
      await supabase.auth.signOut();
      const url = new URL(STALE_REDIRECT_PATH, request.url);
      return NextResponse.redirect(url);
    }
  }

  return response;
}
