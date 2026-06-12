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
 * Forecast function env (Block 8 Wave 2b). Server-only, lazy — only the batch
 * steps read it. The Python function deploys as a separate Vercel function, so
 * the batch reaches it over HTTP: explicit FORECAST_API_URL wins (local dev
 * points at the venv runner); on Vercel we fall back to the deployment's own
 * host. FORECAST_API_SECRET is shared-secret hardening — when set, the Python
 * function refuses requests without the matching `x-forecast-secret` header.
 */
export function forecastEnv() {
  const explicit = process.env.FORECAST_API_URL;
  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL ?? null;
  const base = explicit ?? (vercelHost ? `https://${vercelHost}` : null);
  if (!base) throw new Error('Missing required env var: FORECAST_API_URL');
  return {
    FORECAST_API_URL: base.replace(/\/$/, ''),
    FORECAST_API_SECRET: process.env.FORECAST_API_SECRET ?? null,
    // Vercel Deployment Protection covers this project's *.vercel.app URLs
    // (ssoProtection: all_except_custom_domains), including the batch's own
    // call to /api/forecast. When Protection Bypass for Automation is enabled
    // (project settings), Vercel injects this secret; the API client sends it
    // as x-vercel-protection-bypass so the edge admits the request.
    FORECAST_PROTECTION_BYPASS: process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? null,
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
