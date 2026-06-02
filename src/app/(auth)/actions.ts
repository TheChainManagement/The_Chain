'use server';

import { redirect } from 'next/navigation';
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
