import { generateToken } from './token';
import type { PalGateApiEnvelope, PalGateCredentials, SplitDeviceId } from './types';

export const BASE_URL = 'https://api1.pal-es.com/v1/bt/';
export const ANDROID_USER_AGENT = 'okhttp/4.9.3';

const OPEN_RETRY_DELAYS_MS = [500];

export class PalGateApiError extends Error {
  status?: number;
  body?: unknown;

  constructor(message: string, status?: number, body?: unknown) {
    super(message);
    this.name = 'PalGateApiError';
    this.status = status;
    this.body = body;
  }
}

export type SecondaryInitAttempt = {
  httpStatus: number | null;
  ok: boolean;
  data: unknown;
  error: string | null;
  snippet: string;
  elapsedMs: number;
};

export function splitDeviceId(deviceId: string): SplitDeviceId {
  if (typeof deviceId === 'string' && deviceId.includes(':')) {
    const parts = deviceId.split(':');
    const num = parseInt(parts.pop() ?? '', 10);
    if (Number.isFinite(num) && num > 0) {
      return { baseId: parts.join(':'), outputNum: num };
    }
  }
  return { baseId: deviceId, outputNum: 1 };
}

export function derivedTokenHeader(credentials: PalGateCredentials): string {
  return generateToken(
    credentials.sessionToken,
    credentials.phoneNumber,
    credentials.tokenType,
  );
}

function basicHeaders(tokenHeader?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: '*/*',
    'Accept-Language': 'en-us',
    'Content-Type': 'application/json',
    'User-Agent': ANDROID_USER_AGENT,
    // open-gate is a GET — without this, OkHttp may reuse a prior 200 and
    // we log success without sending a new open command.
    'Cache-Control': 'no-cache, no-store',
    Pragma: 'no-cache',
  };
  if (tokenHeader !== undefined) {
    headers['X-Bt-Token'] = tokenHeader;
  }
  return headers;
}

function isRetryableStatus(status: number): boolean {
  return status >= 500;
}

function snippetOf(data: unknown, max = 220): string {
  if (data == null) return '(empty)';
  const text = typeof data === 'string' ? data : JSON.stringify(data);
  if (!text) return '(empty)';
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function envelopeFailed(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const env = data as PalGateApiEnvelope;
  // err may be boolean, string code, or non-zero number
  if (env.err === true || (typeof env.err === 'string' && env.err.length > 0)) {
    return true;
  }
  if (typeof env.err === 'number' && env.err !== 0) return true;
  if (env.status !== undefined && env.status !== 'ok') return true;
  return false;
}

/** open-gate must return a real JSON envelope — empty/cached junk is failure. */
function assertOpenGateResponse(data: unknown): void {
  if (data == null || typeof data !== 'object') {
    throw new PalGateApiError(
      'Open-gate returned empty or non-JSON body (possible HTTP cache)',
      undefined,
      data,
    );
  }
  if (envelopeFailed(data)) {
    const env = data as PalGateApiEnvelope;
    throw new PalGateApiError(
      env.msg ? String(env.msg) : 'PalGate open-gate returned error',
      undefined,
      data,
    );
  }
}

async function getJson(
  endpoint: string,
  tokenHeader?: string,
  options?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<unknown> {
  if (options?.signal?.aborted) {
    throw new PalGateApiError('Request cancelled');
  }

  const controller = new AbortController();
  const timeoutMs = options?.timeoutMs ?? 10000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  options?.signal?.addEventListener('abort', onExternalAbort, { once: true });

  try {
    const response = await fetch(`${BASE_URL}${endpoint}`, {
      method: 'GET',
      headers: basicHeaders(tokenHeader),
      // RN/OkHttp: never serve a stale GET for mutating open-gate calls.
      cache: 'no-store',
      signal: controller.signal,
    });
    const data = await parseJson(response);
    if (!response.ok) {
      throw new PalGateApiError(
        `API call error: ${response.status}`,
        response.status,
        data,
      );
    }
    if (envelopeFailed(data)) {
      const env = data as PalGateApiEnvelope;
      throw new PalGateApiError(
        env.msg ? String(env.msg) : 'PalGate API returned error',
        response.status,
        data,
      );
    }
    return data;
  } catch (error) {
    if (options?.signal?.aborted) {
      throw new PalGateApiError('Request cancelled');
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new PalGateApiError(`API call timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    options?.signal?.removeEventListener('abort', onExternalAbort);
  }
}

async function getJsonWithRetry(
  endpoint: string,
  tokenHeader: string,
  retryDelaysMs: number[] = OPEN_RETRY_DELAYS_MS,
): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
    try {
      return await getJson(endpoint, tokenHeader);
    } catch (error) {
      lastError = error;
      const status = error instanceof PalGateApiError ? error.status : undefined;
      const retryable =
        !(error instanceof PalGateApiError) ||
        status === undefined ||
        isRetryableStatus(status);
      if (!retryable || attempt === retryDelaysMs.length) break;
      await new Promise((r) => setTimeout(r, retryDelaysMs[attempt]));
    }
  }
  throw lastError;
}

/**
 * Linked Device long-poll with full debug details.
 * Does NOT throw on PalGate error envelopes — caller decides retry vs success.
 */
export async function secondaryInitAttempt(
  uuid: string,
  options?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<SecondaryInitAttempt> {
  if (options?.signal?.aborted) {
    return {
      httpStatus: null,
      ok: false,
      data: null,
      error: 'Request cancelled',
      snippet: '(cancelled)',
      elapsedMs: 0,
    };
  }

  const timeoutMs = options?.timeoutMs ?? 180_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  options?.signal?.addEventListener('abort', onExternalAbort, { once: true });
  const started = Date.now();

  try {
    const response = await fetch(`${BASE_URL}un/secondary/init/${uuid}`, {
      method: 'GET',
      headers: basicHeaders(),
      signal: controller.signal,
    });
    const data = await parseJson(response);
    const elapsedMs = Date.now() - started;
    const envMsg =
      data && typeof data === 'object' && 'msg' in data
        ? String((data as PalGateApiEnvelope).msg ?? '')
        : '';
    const failed = !response.ok || envelopeFailed(data);
    return {
      httpStatus: response.status,
      ok: !failed,
      data,
      error: failed
        ? envMsg || `HTTP ${response.status}`
        : null,
      snippet: snippetOf(data),
      elapsedMs,
    };
  } catch (error) {
    const elapsedMs = Date.now() - started;
    if (options?.signal?.aborted) {
      return {
        httpStatus: null,
        ok: false,
        data: null,
        error: 'Request cancelled',
        snippet: '(cancelled)',
        elapsedMs,
      };
    }
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        httpStatus: null,
        ok: false,
        data: null,
        error: `long-poll timeout after ${timeoutMs}ms (still waiting)`,
        snippet: '(no body — connection held until scan)',
        elapsedMs,
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      httpStatus: null,
      ok: false,
      data: null,
      error: message,
      snippet: message,
      elapsedMs,
    };
  } finally {
    clearTimeout(timer);
    options?.signal?.removeEventListener('abort', onExternalAbort);
  }
}

/**
 * Unauthenticated Linked Device wait (throws on hard failures).
 * Prefer secondaryInitAttempt for the link screen.
 */
export async function secondaryInit(
  uuid: string,
  options?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<unknown> {
  const attempt = await secondaryInitAttempt(uuid, options);
  if (options?.signal?.aborted || attempt.error === 'Request cancelled') {
    throw new PalGateApiError('Request cancelled');
  }
  if (!attempt.ok) {
    throw new PalGateApiError(
      attempt.error ?? 'secondary/init failed',
      attempt.httpStatus ?? undefined,
      attempt.data,
    );
  }
  return attempt.data;
}

export async function checkToken(credentials: PalGateCredentials): Promise<unknown> {
  const ts = Math.floor(Date.now() / 1000);
  const token = derivedTokenHeader(credentials);
  return getJson(`user/check-token?ts=${ts}&ts_diff=0`, token);
}

export async function getDevices(credentials: PalGateCredentials): Promise<unknown> {
  const token = derivedTokenHeader(credentials);
  return getJsonWithRetry('devices', token);
}

export async function openGate(
  credentials: PalGateCredentials,
  deviceId: string,
): Promise<unknown> {
  const trimmed = typeof deviceId === 'string' ? deviceId.trim() : '';
  if (!trimmed) {
    throw new PalGateApiError('Missing deviceId for open-gate');
  }
  const { baseId, outputNum } = splitDeviceId(trimmed);
  if (!baseId) {
    throw new PalGateApiError(`Invalid deviceId for open-gate: ${trimmed}`);
  }
  const token = derivedTokenHeader(credentials);
  // Unique query defeats URL-keyed HTTP caches (token is header-only).
  const bust = Date.now();
  const data = await getJsonWithRetry(
    `device/${baseId}/open-gate?outputNum=${outputNum}&_=${bust}`,
    token,
    OPEN_RETRY_DELAYS_MS,
  );
  assertOpenGateResponse(data);
  return data;
}

export async function secondaryStatus(credentials: PalGateCredentials): Promise<unknown> {
  const token = derivedTokenHeader(credentials);
  return getJson('secondary/status', token);
}
