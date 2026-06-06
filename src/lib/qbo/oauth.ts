/**
 * QuickBooks Online OAuth 2.0 (Block 6 Wave 6.2).
 *
 * Authorization-code grant against Intuit's endpoints (confirmed from the
 * OpenID discovery doc). Pure helpers + an injectable `TokenHttp` seam so the
 * code exchange/refresh unit-test against canned responses (no live Intuit).
 * HTTP outcomes map to the adapter error taxonomy: 429/5xx → RetryableError,
 * other non-2xx → FatalError. Tokens are never logged.
 */

import { FatalError, RetryableError } from '@/lib/source-adapter';

export const QBO_AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2';
export const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
export const QBO_REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';
/** QBO accounting API scope (items, vendors, POs, bills, sales). */
export const QBO_ACCOUNTING_SCOPE = 'com.intuit.quickbooks.accounting';

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Access-token lifetime in seconds (typically 3600). */
  expiresIn: number;
  /** Refresh-token lifetime in seconds (~100 days). */
  refreshExpiresIn: number;
  /** ISO time the tokens were obtained — the expiry clock starts here. */
  obtainedAt: string;
}

// ----- HTTP seam (the one place token-endpoint I/O happens) -----

export interface TokenHttpRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}
export interface TokenHttpResponse {
  status: number;
  body: unknown;
}
export type TokenHttp = (req: TokenHttpRequest) => Promise<TokenHttpResponse>;

export const fetchTokenHttp: TokenHttp = async (req) => {
  const res = await fetch(req.url, { method: 'POST', headers: req.headers, body: req.body });
  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }
  return { status: res.status, body };
};

// ----- authorize URL -----

export function buildAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  scope?: string;
}): string {
  const u = new URL(QBO_AUTHORIZE_URL);
  u.searchParams.set('client_id', params.clientId);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', params.scope ?? QBO_ACCOUNTING_SCOPE);
  u.searchParams.set('redirect_uri', params.redirectUri);
  u.searchParams.set('state', params.state);
  return u.toString();
}

// ----- token exchange + refresh + revoke -----

function basicAuth(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
}

function formHeaders(clientId: string, clientSecret: string): Record<string, string> {
  return {
    Authorization: basicAuth(clientId, clientSecret),
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };
}

function assertOk(status: number): void {
  if (status >= 200 && status < 300) return;
  if (status === 429 || status >= 500) {
    throw new RetryableError(`QuickBooks token endpoint returned ${status}.`);
  }
  throw new FatalError(`QuickBooks OAuth request failed (${status}).`, { code: 'oauth' });
}

function parseTokens(body: unknown, nowIso: string): OAuthTokens {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.access_token !== 'string' || typeof b.refresh_token !== 'string') {
    throw new FatalError('QuickBooks token response did not include tokens.', {
      code: 'token_response',
    });
  }
  return {
    accessToken: b.access_token,
    refreshToken: b.refresh_token,
    expiresIn: Number(b.expires_in ?? 3600),
    refreshExpiresIn: Number(b.x_refresh_token_expires_in ?? 8_726_400),
    obtainedAt: nowIso,
  };
}

export async function exchangeAuthCode(
  http: TokenHttp,
  p: { clientId: string; clientSecret: string; redirectUri: string; code: string; nowIso: string },
): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: p.code,
    redirect_uri: p.redirectUri,
  }).toString();
  const res = await http({
    url: QBO_TOKEN_URL,
    headers: formHeaders(p.clientId, p.clientSecret),
    body,
  });
  assertOk(res.status);
  return parseTokens(res.body, p.nowIso);
}

export async function refreshAccessToken(
  http: TokenHttp,
  p: { clientId: string; clientSecret: string; refreshToken: string; nowIso: string },
): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: p.refreshToken,
  }).toString();
  const res = await http({
    url: QBO_TOKEN_URL,
    headers: formHeaders(p.clientId, p.clientSecret),
    body,
  });
  assertOk(res.status);
  return parseTokens(res.body, p.nowIso);
}

export async function revokeToken(
  http: TokenHttp,
  p: { clientId: string; clientSecret: string; token: string },
): Promise<void> {
  const res = await http({
    url: QBO_REVOKE_URL,
    headers: {
      Authorization: basicAuth(p.clientId, p.clientSecret),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ token: p.token }),
  });
  // Revoke is best-effort; a 4xx (already-revoked token) shouldn't block disconnect.
  if (res.status >= 500) {
    throw new RetryableError(`QuickBooks revoke returned ${res.status}.`);
  }
}
