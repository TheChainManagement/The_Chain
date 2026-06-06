import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { qboEnv } from '@/lib/env';
import { saveQboConnection } from '@/lib/qbo/connection';
import { exchangeAuthCode, fetchTokenHttp } from '@/lib/qbo/oauth';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServer } from '@/lib/supabase/server';

/**
 * QBO OAuth 2.0 redirect handler (Block 6 Wave 6.2).
 *
 * Intuit redirects here with `code`, `state`, `realmId`. We verify the CSRF
 * state cookie, confirm the caller's tenant + role from the session, exchange
 * the code for tokens, encrypt + store the connection, and bounce back to the
 * connect screen with a status flag. Tokens never touch the URL or the logs.
 */

// No `export const dynamic` here: it's incompatible with cacheComponents (Next 16),
// and this handler is inherently dynamic anyway (reads cookies + searchParams).

const STATE_COOKIE = 'qbo_oauth_state';
const DEST = '/integrations/quickbooks';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const params = url.searchParams;
  const back = (query: string) => NextResponse.redirect(new URL(`${DEST}?${query}`, url.origin));

  const jar = await cookies();
  const expectedState = jar.get(STATE_COOKIE)?.value;
  jar.delete(STATE_COOKIE);

  if (params.get('error'))
    return back(`qbo_error=${encodeURIComponent(params.get('error') ?? '')}`);

  const code = params.get('code');
  const state = params.get('state');
  const realmId = params.get('realmId');
  if (!code || !state || !realmId) return back('qbo_error=missing_params');
  // Constant-time-ish compare: lengths first, then value.
  if (!expectedState || state.length !== expectedState.length || state !== expectedState) {
    return back('qbo_error=state_mismatch');
  }

  const supabase = await createSupabaseServer();
  const { data: claims } = await supabase.auth.getClaims();
  const tenantId = claims?.claims?.tenant_id as string | undefined;
  const role = claims?.claims?.tenant_role as string | undefined;
  if (!tenantId) return back('qbo_error=session');
  if (role !== 'owner' && role !== 'manager') return back('qbo_error=forbidden');

  try {
    const env = qboEnv();
    const tokens = await exchangeAuthCode(fetchTokenHttp, {
      clientId: env.QBO_CLIENT_ID,
      clientSecret: env.QBO_CLIENT_SECRET,
      redirectUri: env.QBO_REDIRECT_URI,
      code,
      nowIso: new Date().toISOString(),
    });
    const admin = createSupabaseAdmin();
    await saveQboConnection(admin, { tenantId, realmId, credentials: { ...tokens, realmId } });
    return back('connected=1');
  } catch (err) {
    // No tokens/PII in the log — just the failure shape for prod debugging.
    console.error(
      '[qbo/oauth/callback] exchange failed:',
      err instanceof Error ? err.message : err,
    );
    return back('qbo_error=exchange_failed');
  }
}
