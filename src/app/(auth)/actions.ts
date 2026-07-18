'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  createProvisionalPasswordProof,
  matchesProvisionalPasswordProof,
  PROVISIONAL_PASSWORD_PROOF_COOKIE,
} from '@/lib/access/provisional-password-proof';
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
  const { data: signInData, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { ok: false, error: 'That email and password do not match.' };
  }

  // A provisional account is authenticated but intentionally has no membership
  // claims yet. Existing members can also have a second company waiting. In
  // both cases activation takes precedence over the bench.
  const { data: pending } = await supabase.rpc('my_pending_tenant_access');
  if (Array.isArray(pending) && pending.length > 0) {
    const provision = pending[0];
    const cookieStore = await cookies();
    if (provision?.requires_password_change) {
      if (!signInData.user?.id) {
        await supabase.auth.signOut({ scope: 'local' });
        return { ok: false, error: 'Sign in again before activating company access.' };
      }
      const expiresAt = new Date(String(provision.credential_expires_at ?? '')).getTime();
      const remainingSeconds = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      cookieStore.set(
        PROVISIONAL_PASSWORD_PROOF_COOKIE,
        createProvisionalPasswordProof({
          userId: signInData.user.id,
          provisionId: provision.provision_id,
          password,
        }),
        {
          httpOnly: true,
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
          path: '/activate-account',
          maxAge: remainingSeconds,
        },
      );
    } else {
      cookieStore.set(PROVISIONAL_PASSWORD_PROOF_COOKIE, '', {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/activate-account',
        maxAge: 0,
      });
    }
    redirect('/activate-account');
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

/**
 * Origin for the emailed reset link. Prefer a trusted, configured source over
 * the request's Host header, which a client can spoof to point recovery emails
 * at an attacker origin. Order: explicit NEXT_PUBLIC_SITE_URL, then the
 * Vercel-injected production URL (same source forecastEnv trusts), then the
 * request headers for local dev. Supabase's redirect-URL allowlist is the final
 * backstop — it rejects any redirectTo not on the list — but deriving the origin
 * from a trusted source keeps the link correct in the first place.
 */
async function requestOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (configured) {
    return configured.startsWith('http') ? configured.replace(/\/$/, '') : `https://${configured}`;
  }
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
  // Best-effort: an audit hiccup must never leave the user locked out, but a
  // failed insert or profile lookup is logged (not swallowed) so a broken audit
  // path is observable rather than silently optional.
  try {
    const admin = createSupabaseAdmin();
    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('active_tenant_id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (profileError) {
      console.error('password reset audit: profile lookup failed', profileError);
    } else if (profile?.active_tenant_id) {
      const { error: insertError } = await admin.from('audit_log').insert({
        tenant_id: profile.active_tenant_id,
        actor_user_id: user.id,
        entity_type: 'auth',
        entity_id: null,
        action: 'auth.password_reset',
        after: { method: 'email_recovery' },
      });
      if (insertError) {
        console.error('password reset audit: insert failed', insertError);
      }
    }
  } catch (auditError) {
    console.error('password reset audit write failed', auditError);
  }

  redirect('/today');
}

export async function activateProvision(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const provisionId = String(formData.get('provision_id') ?? '');
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');
  if (!provisionId) return { ok: false, error: 'That access record is unavailable.' };

  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sign in again with the credentials you were given.' };

  const { data: pending, error: pendingError } = await supabase.rpc('my_pending_tenant_access');
  const provision = Array.isArray(pending)
    ? pending.find((row) => row.provision_id === provisionId)
    : null;
  if (pendingError || !provision) return { ok: false, error: 'That access record is unavailable.' };

  if (provision.requires_password_change) {
    if (password.length < 6)
      return { ok: false, error: 'Use a password with at least 6 characters.' };
    if (password !== confirm)
      return { ok: false, error: 'Those passwords do not match. Type the same one twice.' };
    const expiry = new Date(String(provision.credential_expires_at ?? '')).getTime();
    if (!Number.isFinite(expiry) || expiry <= Date.now()) {
      return {
        ok: false,
        error: 'That temporary password expired. Ask an owner or manager to create a new one.',
      };
    }
    const cookieStore = await cookies();
    const proof = cookieStore.get(PROVISIONAL_PASSWORD_PROOF_COOKIE)?.value;
    if (!proof) {
      return { ok: false, error: 'Sign in again with the temporary password before activating.' };
    }
    if (
      matchesProvisionalPasswordProof(proof, {
        userId: user.id,
        provisionId,
        password,
      })
    ) {
      return { ok: false, error: 'Choose a password different from the temporary password.' };
    }
    const { error: passwordError } = await supabase.auth.updateUser({ password });
    if (passwordError) {
      return {
        ok: false,
        error: /different from the old password/i.test(passwordError.message)
          ? 'Choose a password different from the temporary password.'
          : 'We could not update your password. Please try again.',
      };
    }
    const admin = createSupabaseAdmin();
    const { data: marked, error: markError } = await admin.rpc(
      'mark_provisional_password_replaced',
      { p_provision: provisionId, p_auth_user: user.id },
    );
    if (markError || marked !== true) {
      return { ok: false, error: 'The credential expired before activation. Ask for a new one.' };
    }
  }

  const { error: activationError } = await supabase.rpc('activate_tenant_access', {
    p_provision: provisionId,
  });
  if (activationError) {
    return { ok: false, error: 'We could not activate company access. Please try again.' };
  }
  await supabase.auth.refreshSession();
  const cookieStore = await cookies();
  cookieStore.set(PROVISIONAL_PASSWORD_PROOF_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/activate-account',
    maxAge: 0,
  });
  redirect('/today');
}
