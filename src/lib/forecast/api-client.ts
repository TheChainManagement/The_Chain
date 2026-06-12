/**
 * HTTP client for the Python `/api/forecast` function (Block 8 Wave 2b).
 *
 * The forecaster is a separate Vercel Python function — pure compute, no DB —
 * so the batch reaches it over HTTP. This wrapper owns exactly two things:
 *
 *   1. The request/response contract (typed mirror of api/forecast/index.py).
 *   2. The adapter error taxonomy: 429/5xx/network → `RetryableError` (the
 *      caller skips the SKU this run and records a retryable failure); other
 *      4xx → `FatalError` (bad input — dead-letter the SKU, don't retry).
 *
 * The fetch is injectable so the batch core tests run against a scripted
 * forecaster with exact outputs.
 */

import type { ForecastMethod } from '@/lib/forecast/routing';
import { FatalError, RetryableError } from '@/lib/source-adapter';

export interface ForecastRequest {
  series: Array<{ ds: string; y: number }>;
  h: number;
  method: Exclude<ForecastMethod, 'benchmark'>;
  freq: 'W';
  season_length: number;
  levels: [80, 95];
}

export interface ForecastPointOut {
  ds: string;
  yhat: number | null;
  lo80: number | null;
  hi80: number | null;
  lo95: number | null;
  hi95: number | null;
}

export interface ForecastResponse {
  ok: true;
  method: string;
  n_obs: number;
  points: ForecastPointOut[];
  evaluation: {
    rmsse: number | null;
    wape: number | null;
    baseline_rmsse: number | null;
    beats_baseline: boolean;
    n_windows: number;
    error: string | null;
  };
}

export type ForecastFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface ForecastApiConfig {
  baseUrl: string;
  secret: string | null;
  /** Vercel Protection Bypass for Automation secret (deployment-protected URLs). */
  protectionBypass?: string | null;
  fetchImpl?: ForecastFetch;
}

export async function callForecastApi(
  config: ForecastApiConfig,
  request: ForecastRequest,
): Promise<ForecastResponse> {
  const doFetch = config.fetchImpl ?? fetch;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (config.secret) headers['x-forecast-secret'] = config.secret;
  if (config.protectionBypass) headers['x-vercel-protection-bypass'] = config.protectionBypass;

  let response: Response;
  try {
    response = await doFetch(`${config.baseUrl}/api/forecast`, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
    });
  } catch (err) {
    throw new RetryableError(
      `forecast function unreachable: ${err instanceof Error ? err.message : 'network error'}`,
    );
  }

  if (response.status === 429 || response.status >= 500) {
    const retryAfter = response.headers.get('retry-after');
    throw new RetryableError(`forecast function ${response.status}`, {
      retryAfter: retryAfter ? `${retryAfter}s` : undefined,
    });
  }
  if (!response.ok) {
    const detail = await safeError(response);
    throw new FatalError(`forecast function rejected the request: ${detail}`, {
      code: 'forecast_invalid_input',
    });
  }

  const body = (await response.json()) as ForecastResponse | { ok: false; error: string };
  if (!body.ok) {
    throw new FatalError(`forecast function error: ${body.error}`, {
      code: 'forecast_invalid_input',
    });
  }
  return body;
}

async function safeError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? `status ${response.status}`;
  } catch {
    return `status ${response.status}`;
  }
}
