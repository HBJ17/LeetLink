// Small fetch helper used for every outgoing API call. Handles JSON bodies,
// auth headers, rate limits and retries on transient failures.

export class HttpError extends Error {
  override name = 'HttpError';
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown = null,
  ) {
    super(message);
  }
}

export class RateLimitError extends HttpError {
  override name = 'RateLimitError';
  constructor(readonly resetAt: Date | null) {
    super(429, resetAt ? `Rate limited until ${resetAt.toLocaleTimeString()}` : 'Rate limited');
  }
}

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  /** Serialized as JSON when present. */
  json?: unknown;
  /** Retries for network errors and 5xx responses. */
  retries?: number;
}

const RETRY_BASE_MS = 500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rateLimitReset(response: Response): Date | null {
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter && /^\d+$/.test(retryAfter)) return new Date(Date.now() + Number(retryAfter) * 1000);
  const reset = response.headers.get('x-ratelimit-reset');
  if (reset && /^\d+$/.test(reset)) return new Date(Number(reset) * 1000);
  return null;
}

function isRateLimited(response: Response): boolean {
  if (response.status === 429) return true;
  return response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0';
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorMessage(status: number, body: unknown): string {
  if (typeof body === 'object' && body !== null && 'message' in body) {
    return `${status}: ${String((body as { message: unknown }).message)}`;
  }
  return `Request failed with status ${status}`;
}

/** Performs a request and returns the parsed JSON body (or null for empty responses). */
export async function request<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', headers = {}, json, retries = 2 } = options;
  const init: RequestInit = { method, headers: { ...headers } };
  if (json !== undefined) {
    init.body = JSON.stringify(json);
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
  }

  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (err) {
      if (attempt < retries) {
        await delay(RETRY_BASE_MS * 2 ** attempt);
        continue;
      }
      throw new HttpError(0, 'Network error. Check your connection.', String(err));
    }

    if (isRateLimited(response)) throw new RateLimitError(rateLimitReset(response));

    if (response.status >= 500 && attempt < retries) {
      await delay(RETRY_BASE_MS * 2 ** attempt);
      continue;
    }

    const body = await readBody(response);
    if (!response.ok) throw new HttpError(response.status, errorMessage(response.status, body), body);
    return body as T;
  }
}
