import { type NextRequest, NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabase/server';

/**
 * Auth email confirmation target (Wave 2 kickoff Item 0: password reset).
 *
 * The recovery email lands here. Two link shapes are accepted:
 *   - token_hash + type — the Supabase "email link goes straight to your app"
 *     template shape ({{ .TokenHash }}). Verified via verifyOtp. Works even
 *     when the link is opened in a different browser than the one that asked.
 *   - code — the default {{ .ConfirmationURL }} PKCE shape, where Supabase
 *     verifies first and redirects here with an exchange code. Same-browser only
 *     (the PKCE verifier lives in this browser's cookies).
 *
 * This route belongs to the reset flow ONLY: `type` must be `recovery`, so a
 * link carrying another Supabase email-token type (signup, email_change, magic
 * link) cannot be consumed here to mint a session and land on /reset-password.
 *
 * On success the session cookie is set and the user continues to `next`
 * (default /reset-password). On any failure they land back on /forgot-password
 * with an expired notice. `next` is confined to same-origin paths.
 */

function safeNext(raw: string | null): string {
  if (raw?.startsWith('/') && !raw.startsWith('//')) return raw;
  return '/reset-password';
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type');
  const code = url.searchParams.get('code');
  const next = safeNext(url.searchParams.get('next'));

  const supabase = await createSupabaseServer();

  if (tokenHash && type === 'recovery') {
    const { error } = await supabase.auth.verifyOtp({ type: 'recovery', token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }

  return NextResponse.redirect(new URL('/forgot-password?error=expired', url.origin));
}
