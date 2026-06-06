import { describe, expect, it } from 'vitest';
import {
  buildAuthorizeUrl,
  exchangeAuthCode,
  QBO_ACCOUNTING_SCOPE,
  refreshAccessToken,
  revokeToken,
  type TokenHttp,
  type TokenHttpRequest,
} from '@/lib/qbo/oauth';
import { FatalError, RetryableError } from '@/lib/source-adapter';

function cannedHttp(response: { status: number; body: unknown }): { http: TokenHttp; seen: TokenHttpRequest[] } {
  const seen: TokenHttpRequest[] = [];
  const http: TokenHttp = async (req) => {
    seen.push(req);
    return response;
  };
  return { http, seen };
}

const TOKEN_BODY = {
  access_token: 'AT-123',
  refresh_token: 'RT-456',
  expires_in: 3600,
  x_refresh_token_expires_in: 8_726_400,
  token_type: 'bearer',
};

describe('buildAuthorizeUrl', () => {
  it('builds the Intuit authorize URL with the accounting scope + state', () => {
    const url = new URL(
      buildAuthorizeUrl({ clientId: 'CID', redirectUri: 'http://localhost:3100/cb', state: 'st8' }),
    );
    expect(url.origin + url.pathname).toBe('https://appcenter.intuit.com/connect/oauth2');
    expect(url.searchParams.get('client_id')).toBe('CID');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe(QBO_ACCOUNTING_SCOPE);
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3100/cb');
    expect(url.searchParams.get('state')).toBe('st8');
  });
});

describe('exchangeAuthCode', () => {
  it('exchanges a code, sending Basic auth + the authorization_code grant', async () => {
    const { http, seen } = cannedHttp({ status: 200, body: TOKEN_BODY });
    const tokens = await exchangeAuthCode(http, {
      clientId: 'CID',
      clientSecret: 'SEC',
      redirectUri: 'http://localhost:3100/cb',
      code: 'authcode',
      nowIso: '2026-06-05T12:00:00.000Z',
    });
    expect(tokens.accessToken).toBe('AT-123');
    expect(tokens.refreshToken).toBe('RT-456');
    expect(tokens.expiresIn).toBe(3600);
    expect(tokens.obtainedAt).toBe('2026-06-05T12:00:00.000Z');

    const req = seen[0]!;
    expect(req.url).toBe('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer');
    expect(req.headers.Authorization).toBe(`Basic ${Buffer.from('CID:SEC').toString('base64')}`);
    expect(req.body).toContain('grant_type=authorization_code');
    expect(req.body).toContain('code=authcode');
  });

  it('throws FatalError(code=oauth) on a 401', async () => {
    const { http } = cannedHttp({ status: 401, body: { error: 'invalid_grant' } });
    await expect(
      exchangeAuthCode(http, { clientId: 'C', clientSecret: 'S', redirectUri: 'r', code: 'c', nowIso: 'n' }),
    ).rejects.toMatchObject({ name: 'FatalError', code: 'oauth' });
  });

  it('throws RetryableError on a 429', async () => {
    const { http } = cannedHttp({ status: 429, body: {} });
    await expect(
      exchangeAuthCode(http, { clientId: 'C', clientSecret: 'S', redirectUri: 'r', code: 'c', nowIso: 'n' }),
    ).rejects.toBeInstanceOf(RetryableError);
  });

  it('throws FatalError when a 200 body is missing tokens', async () => {
    const { http } = cannedHttp({ status: 200, body: { token_type: 'bearer' } });
    await expect(
      exchangeAuthCode(http, { clientId: 'C', clientSecret: 'S', redirectUri: 'r', code: 'c', nowIso: 'n' }),
    ).rejects.toMatchObject({ name: 'FatalError', code: 'token_response' });
  });
});

describe('refreshAccessToken', () => {
  it('sends the refresh_token grant and returns rotated tokens', async () => {
    const { http, seen } = cannedHttp({ status: 200, body: { ...TOKEN_BODY, access_token: 'AT-new' } });
    const tokens = await refreshAccessToken(http, {
      clientId: 'C',
      clientSecret: 'S',
      refreshToken: 'RT-old',
      nowIso: '2026-06-05T13:00:00.000Z',
    });
    expect(tokens.accessToken).toBe('AT-new');
    expect(seen[0]!.body).toContain('grant_type=refresh_token');
    expect(seen[0]!.body).toContain('refresh_token=RT-old');
  });
});

describe('revokeToken', () => {
  it('tolerates a 200 and a 4xx (already-revoked), throws only on 5xx', async () => {
    const ok = cannedHttp({ status: 200, body: {} });
    await expect(revokeToken(ok.http, { clientId: 'C', clientSecret: 'S', token: 't' })).resolves.toBeUndefined();

    const gone = cannedHttp({ status: 400, body: {} });
    await expect(revokeToken(gone.http, { clientId: 'C', clientSecret: 'S', token: 't' })).resolves.toBeUndefined();

    const down = cannedHttp({ status: 503, body: {} });
    await expect(revokeToken(down.http, { clientId: 'C', clientSecret: 'S', token: 't' })).rejects.toBeInstanceOf(
      RetryableError,
    );
  });
});
