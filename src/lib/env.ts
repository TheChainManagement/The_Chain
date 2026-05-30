/**
 * Typed environment access. Throws at module load if required vars are missing.
 * Use this module from server contexts only — `NEXT_PUBLIC_*` vars are safe
 * everywhere, others must stay server-side.
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const env = {
  // Public — safe on the client.
  SUPABASE_URL: required('NEXT_PUBLIC_SUPABASE_URL'),
  SUPABASE_ANON_KEY: required('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
} as const;

/**
 * Server-only env. Lazily evaluated so importing this module from a Server
 * Component doesn't error at build time when env vars haven't loaded yet.
 */
export function serverEnv() {
  return {
    SUPABASE_SERVICE_ROLE_KEY: required('SUPABASE_SERVICE_ROLE_KEY'),
  };
}
