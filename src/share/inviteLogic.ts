import { TokenType, type PalGateCredentials } from '../palgate/types';

export const INVITE_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const INVITE_CODE_LENGTH = 8;

export type InviteStatus = 'pending' | 'accepted' | 'declined' | 'revoked';

export type SharedGatePayload = {
  deviceId: string;
  name: string;
  nameOverride: string | null;
  lat: number | null;
  lng: number | null;
  radiusMeters: number;
  cooldownMs: number;
  bluetooth: {
    required: boolean;
    devices: Array<{ name?: string; address?: string }>;
  };
  systemLabel: string;
};

export function bytesToInviteCode(bytes: Uint8Array): string {
  let out = '';
  const n = INVITE_CODE_ALPHABET.length;
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    out += INVITE_CODE_ALPHABET[bytes[i % bytes.length] % n];
  }
  return out;
}

export function normalizeInviteCode(raw: string): string {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^23456789ABCDEFGHJKLMNPQRSTUVWXYZ]/g, '')
    .slice(0, INVITE_CODE_LENGTH);
}

export function isValidInviteCode(code: string): boolean {
  return (
    code.length === INVITE_CODE_LENGTH &&
    [...code].every((ch) => INVITE_CODE_ALPHABET.includes(ch))
  );
}

export function sharedGateId(code: string, deviceId: string): string {
  return `share:${code}:${deviceId}`;
}

export function isRealFirebaseAccount(input: {
  isAnonymous: boolean;
  providers: string[];
}): boolean {
  if (input.isAnonymous) return false;
  return (
    input.providers.includes('password') ||
    input.providers.includes('google.com')
  );
}

export function canTransitionInvite(
  from: InviteStatus,
  to: InviteStatus,
  actor: 'owner' | 'invitee',
): boolean {
  if (from === 'pending' && to === 'accepted' && actor === 'invitee') {
    return true;
  }
  if (from === 'pending' && to === 'declined' && actor === 'invitee') {
    return true;
  }
  if (from === 'pending' && to === 'revoked' && actor === 'owner') {
    return true;
  }
  if (from === 'accepted' && to === 'revoked' && actor === 'owner') {
    return true;
  }
  return false;
}

export function isValidPalGateCreds(c: {
  sessionToken?: unknown;
  phoneNumber?: unknown;
  tokenType?: unknown;
}): c is PalGateCredentials {
  const token = String(c.sessionToken ?? '')
    .trim()
    .toLowerCase();
  if (!/^[0-9a-f]+$/.test(token) || token.length < 32 || token.length % 2 !== 0) {
    return false;
  }
  const phone = Number(c.phoneNumber);
  if (!Number.isFinite(phone) || phone <= 0) return false;
  const type = Number(c.tokenType) as TokenType;
  return (
    type === TokenType.SMS ||
    type === TokenType.PRIMARY ||
    type === TokenType.SECONDARY
  );
}
