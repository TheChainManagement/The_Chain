/**
 * Next.js 16 middleware (renamed to proxy.ts in v16). Same export shape —
 * `proxy` function + `config` matcher.
 *
 * THIS IS DEFENSE-IN-DEPTH, NOT THE SOLE AUTH GATE.
 *
 * Per vercel-plugin:routing-middleware skill: proxy.ts / middleware.ts is
 * explicitly NOT for auth-as-sole-protection (CVE-2025-29927 risk via the
 * x-middleware-subrequest header). Auth is enforced in three layers:
 *   1. Supabase Postgres RLS (strongest — tenant isolation + role gating)
 *   2. (app) layout server-side redirect for unauthenticated requests (5H)
 *   3. This file: session refresh + stale-token-generation rejection
 *
 * What this proxy DOES:
 *   - Refreshes the Supabase session cookie when expired
 *   - Calls is_token_stale() RPC; if true, signs out + redirects to /signin?stale=1
 *
 * What this proxy DOES NOT do:
 *   - Gate access to the (app) segment (that lives in the layout's auth check)
 *   - Decide authorization (RLS handles that at the DB layer)
 */

import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     *  - _next/static (build assets)
     *  - _next/image (image optimization)
     *  - favicon, common image extensions
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
