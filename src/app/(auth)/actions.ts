'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServer } from '@/lib/supabase/server';

/**
 * Auth Server Actions. Phase 5H wires sign-in + a minimal atomic sign-up so the
 * (app) auth gate is reachable. Phase 6 ("Account creation + sign-in") hardens
 * copy, validation, the bench transition, and the transaction-abort test.
 *
 * Action shape suits React `useActionState`: (prevState, formData) => state.
 * On success they `redirect()` (which throws), so they only *return* on error.
 */

export type AuthState = { ok: false; error: string } | { ok: true } | null;

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!email || !password) {
    return { ok: false, error: 'Enter your email and password.' };
  }

  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { ok: false, error: 'That email and password do not match.' };
  }

  redirect('/today');
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const business = String(formData.get('business') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!business || !email || !password) {
    return { ok: false, error: 'Business name, email, and password are all required.' };
  }
  if (password.length < 6) {
    return { ok: false, error: 'Use a password with at least 6 characters.' };
  }

  const supabase = await createSupabaseServer();

  const { error: signUpError } = await supabase.auth.signUp({ email, password });
  if (signUpError) {
    return { ok: false, error: signUpError.message };
  }

  // Atomically create the tenant graph as the new authenticated user.
  const { error: bootstrapError } = await supabase.rpc('bootstrap_tenant', {
    p_business_name: business,
  });
  if (bootstrapError) {
    return { ok: false, error: 'We could not set up your workshop. Please try again.' };
  }

  // Re-issue the JWT so the custom access token hook attaches tenant_id, role,
  // and token_generation now that profiles.active_tenant_id exists. The Set-Cookie
  // headers flush on this action response, so the client can navigate to the
  // (auth-gated) bench after it plays the "workshop forming" transition.
  await supabase.auth.refreshSession();

  // Success returns state (no redirect) so AuthForm can morph the signup screen
  // into the bench before navigating. The signup screen becomes the workshop.
  return { ok: true };
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServer();
  await supabase.auth.signOut();
  redirect('/signin');
}

/**
 * Password reset (Wave 2 kickoff Item 0). Two actions:
 *   requestPasswordReset — sends the Supabase recovery email. The link lands on
 *     /api/auth/confirm (verifyOtp / code exchange), which establishes the
 *     recovery session and forwards to /reset-password.
 *   updatePassword — runs under the recovery session, sets the new password,
 *     audit-logs the recovery, and drops the user on /today.
 */

/** Derive the request origin for the emailed redirect link (proxy-aware). */
async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3100';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export async function requestPasswordReset(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get('email') ?? '').trim();
  if (!email) {
    return { ok: false, error: 'Enter the email you signed up with.' };
  }

  const supabase = await createSupabaseServer();
  const origin = await requestOrigin();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/api/auth/confirm?next=/reset-password`,
  });

  // Never reveal whether an account exists: unknown-email errors still return
  // ok. Rate limiting is the one failure worth surfacing honestly.
  if (error && /rate ?limit/i.test(error.message)) {
    return { ok: false, error: 'Too many reset emails just now. Wait a minute and try again.' };
  }
  return { ok: true };
}

export async function updatePassword(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');

  if (password.length < 6) {
    return { ok: false, error: 'Use a password with at least 6 characters.' };
  }
  if (password !== confirm) {
    return { ok: false, error: 'Those passwords do not match. Type the same one twice.' };
  }

  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: 'This reset link expired. Request a new one.' };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    const samePassword = /different from the old password/i.test(error.message);
    return {
      ok: false,
      error: samePassword
        ? 'That is already your password. Pick a new one.'
        : 'We could not update your password. Please try again.',
    };
  }

  // Audit the recovery via the admin client (audit_log is system-write only).
  // Best-effort: an audit hiccup must never leave the user locked out.
  try {
    const admin = createSupabaseAdmin();
    const { data: profile } = await admin
      .from('profiles')
      .select('active_tenant_id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (profile?.active_tenant_id) {
      await admin.from('audit_log').insert({
        tenant_id: profile.active_tenant_id,
        actor_user_id: user.id,
        entity_type: 'auth',
        entity_id: null,
        action: 'auth.password_reset',
        after: { method: 'email_recovery' },
      });
    }
  } catch (auditError) {
    console.error('password reset audit write failed', auditError);
  }

  redirect('/today');
}
