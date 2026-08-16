import { TokenType, type PalGateCredentials } from '../palgate/types';

/** Portable credential payload for personal device transfer (not for event logs). */
export type AccountExportPayload = {
  phoneNumber: number;
  sessionToken: string;
  tokenType: number;
};

export function serializeAccountExport(credentials: PalGateCredentials): string {
  const payload: AccountExportPayload = {
    phoneNumber: credentials.phoneNumber,
    sessionToken: credentials.sessionToken,
    tokenType: credentials.tokenType,
  };
  return JSON.stringify(payload);
}

/**
 * Parse export JSON from QR scan or paste.
 * Accepts compact or pretty JSON; does not log secrets.
 */
export function parseAccountExport(raw: string): PalGateCredentials | null {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;

  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    // Some QR readers wrap or add prefixes — pull the first {...} object.
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      data = JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }

  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;

  const phoneNumber = Number(obj.phoneNumber);
  if (!Number.isFinite(phoneNumber) || phoneNumber <= 0) return null;

  const sessionToken = String(obj.sessionToken ?? '')
    .trim()
    .toLowerCase();
  if (!/^[0-9a-f]+$/i.test(sessionToken) || sessionToken.length % 2 !== 0) {
    return null;
  }

  const tokenType = Number(obj.tokenType) as TokenType;
  if (
    tokenType !== TokenType.SMS &&
    tokenType !== TokenType.PRIMARY &&
    tokenType !== TokenType.SECONDARY
  ) {
    return null;
  }

  return { phoneNumber, sessionToken, tokenType };
}
