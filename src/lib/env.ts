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

/**
 * QuickBooks Online OAuth env (Block 6 Wave 6.2). Server-only, lazy — only the
 * QBO connect paths read it, so the rest of the app runs without these set.
 */
export function qboEnv() {
  const environment = process.env.QBO_ENVIRONMENT === 'production' ? 'production' : 'sandbox';
  return {
    QBO_CLIENT_ID: required('QBO_CLIENT_ID'),
    QBO_CLIENT_SECRET: required('QBO_CLIENT_SECRET'),
    QBO_ENVIRONMENT: environment as 'sandbox' | 'production',
    QBO_REDIRECT_URI: required('QBO_REDIRECT_URI'),
    QBO_TOKEN_ENC_KEY: required('QBO_TOKEN_ENC_KEY'),
  };
}
