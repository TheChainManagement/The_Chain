import { describe, expect, it } from 'vitest';
import {
  callForecastApi,
  type ForecastFetch,
  type ForecastRequest,
} from '@/lib/forecast/api-client';
import { FatalError, RetryableError } from '@/lib/source-adapter';

const REQUEST: ForecastRequest = {
  series: [
    { ds: '2026-05-28', y: 4 },
    { ds: '2026-06-04', y: 6 },
  ],
  h: 8,
  method: 'auto_ets',
  freq: 'W',
  season_length: 1,
  levels: [80, 95],
};

const OK_BODY = {
  ok: true,
  method: 'auto_ets',
  n_obs: 2,
  points: [{ ds: '2026-06-11', yhat: 5.1, lo80: 4.2, hi80: 6.0, lo95: 3.7, hi95: 6.5 }],
  evaluation: {
    rmsse: 0.82,
    wape: 0.19,
    baseline_rmsse: 1.04,
    beats_baseline: true,
    n_windows: 2,
    error: null,
  },
};

function respond(status: number, body: unknown, headers?: Record<string, string>): ForecastFetch {
  return async () => new Response(JSON.stringify(body), { status, headers });
}

describe('callForecastApi — contract + error taxonomy', () => {
  it('returns the typed response on 200', async () => {
    const result = await callForecastApi(
      { baseUrl: 'http://forecast.test', secret: null, fetchImpl: respond(200, OK_BODY) },
      REQUEST,
    );
    expect(result.evaluation.beats_baseline).toBe(true);
    expect(result.points[0]?.yhat).toBeCloseTo(5.1);
  });

  it('sends the shared secret header when configured', async () => {
    let seen: string | null = null;
    const fetchImpl: ForecastFetch = async (_url, init) => {
      seen = (init.headers as Record<string, string>)['x-forecast-secret'] ?? null;
      return new Response(JSON.stringify(OK_BODY), { status: 200 });
    };
    await callForecastApi({ baseUrl: 'http://forecast.test', secret: 's3cr3t', fetchImpl }, REQUEST);
    expect(seen).toBe('s3cr3t');
  });

  it('sends the Vercel protection-bypass header when configured', async () => {
    let seen: string | null = null;
    const fetchImpl: ForecastFetch = async (_url, init) => {
      seen = (init.headers as Record<string, string>)['x-vercel-protection-bypass'] ?? null;
      return new Response(JSON.stringify(OK_BODY), { status: 200 });
    };
    await callForecastApi(
      { baseUrl: 'http://forecast.test', secret: null, protectionBypass: 'bp-77', fetchImpl },
      REQUEST,
    );
    expect(seen).toBe('bp-77');
  });

  it('maps 429 to RetryableError honoring retry-after', async () => {
    const call = callForecastApi(
      {
        baseUrl: 'http://forecast.test',
        secret: null,
        fetchImpl: respond(429, {}, { 'retry-after': '30' }),
      },
      REQUEST,
    );
    await expect(call).rejects.toMatchObject({ name: 'RetryableError', retryAfter: '30s' });
  });

  it('maps 5xx to RetryableError', async () => {
    await expect(
      callForecastApi(
        { baseUrl: 'http://forecast.test', secret: null, fetchImpl: respond(503, {}) },
        REQUEST,
      ),
    ).rejects.toBeInstanceOf(RetryableError);
  });

  it('maps a network throw to RetryableError', async () => {
    const fetchImpl: ForecastFetch = async () => {
      throw new Error('ECONNREFUSED');
    };
    await expect(
      callForecastApi({ baseUrl: 'http://forecast.test', secret: null, fetchImpl }, REQUEST),
    ).rejects.toBeInstanceOf(RetryableError);
  });

  it('maps a 400 rejection to FatalError with the function message', async () => {
    const call = callForecastApi(
      {
        baseUrl: 'http://forecast.test',
        secret: null,
        fetchImpl: respond(400, { ok: false, error: 'need at least 2 observations to forecast' }),
      },
      REQUEST,
    );
    await expect(call).rejects.toBeInstanceOf(FatalError);
    await expect(call).rejects.toThrowError(/at least 2 observations/);
  });

  it('maps an ok:false 200 body to FatalError', async () => {
    await expect(
      callForecastApi(
        {
          baseUrl: 'http://forecast.test',
          secret: null,
          fetchImpl: respond(200, { ok: false, error: 'unknown method: croston_x' }),
        },
        REQUEST,
      ),
    ).rejects.toBeInstanceOf(FatalError);
  });
});
