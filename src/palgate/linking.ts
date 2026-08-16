import { randomUUID } from 'expo-crypto';
import { checkToken, secondaryInitAttempt } from './api';
import { TokenType, type LinkingResult, type SecondaryInitResponse } from './types';

/** Keep each GET under typical mobile proxy limits; reconnect immediately. */
const REQUEST_TIMEOUT_MS = 55_000;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const RETRY_DELAY_MS = 250;
const RATE_LIMIT_DELAY_MS = 3_000;

export type LinkingProgress = {
  uuid: string;
  /**
   * Exact QR payload matching pylgate:
   * {"id": "<uuid>"}  (space after colon)
   */
  qrPayload: string;
};

export type PollInfo = {
  attempt: number;
  uuid: string;
  phase: 'ready' | 'polling' | 'timeout' | 'error' | 'incomplete' | 'linked';
  lastHttpStatus: number | null;
  lastSnippet: string | null;
  lastError: string | null;
  elapsedMs: number | null;
};

export type WaitForLinkOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
  onPoll?: (info: PollInfo) => void;
};

/** Create a Linked Device QR payload (UUID v4), pylgate-compatible. */
export function createLinkSession(): LinkingProgress {
  const uuid = randomUUID();
  // pylgate: qr.add_data(f'{{"id": "{unique_id}"}}')
  const qrPayload = `{"id": "${uuid}"}`;
  return { uuid, qrPayload };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Linking cancelled'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('Linking cancelled'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Parse credentials from secondary/init body.
 * Matches homebridge/pylgate: require user.id + user.token + secondary.
 */
export function parseLinkResponse(data: unknown): LinkingResult | null {
  if (!data || typeof data !== 'object') return null;
  const env = data as SecondaryInitResponse;

  // err may be false/0/null when ok — only reject truthy err.
  if (env.err) return null;
  if (env.status !== undefined && String(env.status).toLowerCase() !== 'ok') {
    return null;
  }
  if (!env.user?.token || env.user.id === undefined || env.user.id === null) {
    return null;
  }
  if (env.secondary === undefined || env.secondary === null || env.secondary === '') {
    return null;
  }

  const phoneNumber = Number(env.user.id);
  if (!Number.isFinite(phoneNumber)) return null;

  const sessionToken = String(env.user.token).trim().toLowerCase();
  if (!/^[0-9a-f]+$/i.test(sessionToken) || sessionToken.length % 2 !== 0) {
    return null;
  }

  const tokenType = Number(env.secondary) as TokenType;
  if (
    tokenType !== TokenType.SMS &&
    tokenType !== TokenType.PRIMARY &&
    tokenType !== TokenType.SECONDARY
  ) {
    return null;
  }

  return { phoneNumber, sessionToken, tokenType };
}

function looksConsumed(error: string | null, snippet: string | null): boolean {
  const hay = `${error ?? ''} ${snippet ?? ''}`.toLowerCase();
  return (
    hay.includes('already') ||
    hay.includes('expired') ||
    hay.includes('not found') ||
    hay.includes('invalid') ||
    hay.includes('used')
  );
}

/**
 * Wait on GET un/secondary/init/{uuid} until linked or timeout.
 *
 * PalGate holds the GET open until the QR is scanned (long-poll). Confirmed via
 * live probe: no body for 20s+. We reconnect every ~55s with almost no gap so
 * backgrounding / mobile idle kills don't leave a dead wait forever.
 *
 * Credentials are one-shot: if PalGate already shows linked and we missed the
 * response, generate a new QR.
 */
export async function waitForLinkedDevice(
  uuid: string,
  options: WaitForLinkOptions = {},
): Promise<LinkingResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const started = Date.now();
  let attempt = 0;

  const emit = (info: Omit<PollInfo, 'attempt' | 'uuid'> & { attempt?: number }) => {
    options.onPoll?.({
      attempt: info.attempt ?? attempt,
      uuid,
      phase: info.phase,
      lastHttpStatus: info.lastHttpStatus,
      lastSnippet: info.lastSnippet,
      lastError: info.lastError,
      elapsedMs: info.elapsedMs,
    });
  };

  emit({
    phase: 'ready',
    lastHttpStatus: null,
    lastSnippet: null,
    lastError: null,
    elapsedMs: null,
  });

  while (Date.now() - started < timeoutMs) {
    if (options.signal?.aborted) {
      throw new Error('Linking cancelled');
    }

    attempt += 1;
    const remaining = timeoutMs - (Date.now() - started);
    const requestTimeoutMs = Math.min(REQUEST_TIMEOUT_MS, Math.max(remaining, 5_000));

    emit({
      phase: 'polling',
      lastHttpStatus: null,
      lastSnippet: `GET un/secondary/init/{uuid} holding up to ${Math.round(requestTimeoutMs / 1000)}s…`,
      lastError: null,
      elapsedMs: null,
    });

    console.log(
      `[GateAuto:link] attempt=${attempt} uuid=${uuid} timeoutMs=${requestTimeoutMs}`,
    );

    const result = await secondaryInitAttempt(uuid, {
      timeoutMs: requestTimeoutMs,
      signal: options.signal,
    });

    if (options.signal?.aborted) {
      throw new Error('Linking cancelled');
    }

    console.log(
      `[GateAuto:link] attempt=${attempt} status=${result.httpStatus} ok=${result.ok} err=${result.error} body=${result.snippet}`,
    );

    const parsed = parseLinkResponse(result.data);
    if (parsed) {
      emit({
        phase: 'linked',
        lastHttpStatus: result.httpStatus,
        lastSnippet: result.snippet,
        lastError: null,
        elapsedMs: result.elapsedMs,
      });
      return parsed;
    }

    const timedOut =
      !!result.error && result.error.toLowerCase().includes('long-poll timeout');

    if (timedOut) {
      emit({
        phase: 'timeout',
        lastHttpStatus: result.httpStatus,
        lastSnippet: result.snippet,
        lastError: result.error,
        elapsedMs: result.elapsedMs,
      });
      // Immediate reconnect — minimize gap where a scan could be missed.
      continue;
    }

    if (result.error === 'Request cancelled') {
      throw new Error('Linking cancelled');
    }

    if (looksConsumed(result.error, result.snippet) && result.httpStatus !== null) {
      emit({
        phase: 'error',
        lastHttpStatus: result.httpStatus,
        lastSnippet: result.snippet,
        lastError: result.error,
        elapsedMs: result.elapsedMs,
      });
      throw new Error(
        `This QR was already used/consumed (${result.error}). Tap New QR, remove the old linked device in PalGate, then scan again.`,
      );
    }

    emit({
      phase: result.ok ? 'incomplete' : 'error',
      lastHttpStatus: result.httpStatus,
      lastSnippet: result.snippet,
      lastError:
        result.error ??
        (result.ok
          ? 'HTTP ok but missing user.token/secondary — still waiting…'
          : 'still waiting…'),
      elapsedMs: result.elapsedMs,
    });

    const delay =
      result.error && result.error.includes('429')
        ? RATE_LIMIT_DELAY_MS
        : RETRY_DELAY_MS;
    if (Date.now() - started >= timeoutMs) break;
    await sleep(delay, options.signal);
  }

  throw new Error(
    'Device linking timed out. Tap New QR and scan again — keep GateAuto open until it says Linked.',
  );
}

/** Full link helper: create QR session, wait, optionally verify with check-token. */
export async function linkSecondaryDevice(
  options: WaitForLinkOptions & { verifyToken?: boolean } = {},
): Promise<{ session: LinkingProgress; credentials: LinkingResult }> {
  const session = createLinkSession();
  const credentials = await waitForLinkedDevice(session.uuid, options);
  if (options.verifyToken !== false) {
    await checkToken(credentials);
  }
  return { session, credentials };
}

/** Parse manually pasted credentials (phone / hex token / type). */
export function parsePastedCredentials(input: {
  phoneNumber: string;
  sessionToken: string;
  tokenType?: string;
}): LinkingResult | null {
  const phoneNumber = Number(String(input.phoneNumber).trim());
  if (!Number.isFinite(phoneNumber) || phoneNumber <= 0) return null;

  const sessionToken = String(input.sessionToken).trim().toLowerCase();
  if (!/^[0-9a-f]+$/i.test(sessionToken) || sessionToken.length % 2 !== 0) {
    return null;
  }

  const tokenType = Number(input.tokenType ?? TokenType.SECONDARY) as TokenType;
  if (
    tokenType !== TokenType.SMS &&
    tokenType !== TokenType.PRIMARY &&
    tokenType !== TokenType.SECONDARY
  ) {
    return null;
  }

  return { phoneNumber, sessionToken, tokenType };
}
