/**
 * QBO transport seam — the one place real HTTP happens, isolated so the client
 * and adapter unit-test against a fake transport (no live Intuit calls).
 *
 * Mirrors the Block 5 pattern where `CsvSourceAdapter` takes its raw sources by
 * construction: here the `QboClient` takes a `QboTransport`, so tests inject
 * canned responses and the fixture preview replays a sandbox dataset, while
 * production swaps in `HttpQboTransport`.
 */

export interface QboRequest {
  method: 'GET' | 'POST';
  /** Absolute URL (the client builds it from realm + environment). */
  url: string;
  body?: unknown;
}

export interface QboResponse {
  status: number;
  /** Header keys are lowercased so lookups (`retry-after`) are case-stable. */
  headers: Record<string, string>;
  body: unknown;
}

export interface QboTransport {
  request(req: QboRequest): Promise<QboResponse>;
}

/**
 * Real fetch-backed transport. Sends the bearer token + JSON headers Intuit's
 * v3 API requires. The access token is read per-request (never logged) so a
 * refreshed token is picked up without rebuilding the client.
 */
export class HttpQboTransport implements QboTransport {
  constructor(private readonly accessToken: () => string) {}

  async request(req: QboRequest): Promise<QboResponse> {
    const res = await fetch(req.url, {
      method: req.method,
      headers: {
        Authorization: `Bearer ${this.accessToken()}`,
        Accept: 'application/json',
        ...(req.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: req.body ? JSON.stringify(req.body) : undefined,
    });

    const headers: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    // QBO returns JSON for both success and Fault bodies; tolerate an empty body.
    let body: unknown = null;
    const text = await res.text();
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { raw: text };
      }
    }

    return { status: res.status, headers, body };
  }
}
