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
  holdEnabled: boolean;
  holdMs: number;
  bluetooth: {
    required: boolean;
    devices: Array<{ name?: string; address?: string }>;
  };
  systemLabel: string;
  /** Index into inviteCreds.packs (0 when a single PalGate system). */
  credIndex: number;
};

export const INVITE_MAX_GATES = 12;
export const INVITE_MAX_PACKS = 8;

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

/** Firestore invite payload bounds (must match firestore.rules). */
export const INVITE_RADIUS_MIN_M = 10;
export const INVITE_RADIUS_MAX_M = 250;
export const INVITE_COOLDOWN_MAX_MS = 3_600_000;
export const INVITE_HOLD_MAX_MS = 90_000;

export function clampInviteRadiusMeters(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 50;
  return Math.min(INVITE_RADIUS_MAX_M, Math.max(INVITE_RADIUS_MIN_M, Math.round(n)));
}

export function clampInviteCooldownMs(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 30_000;
  return Math.min(INVITE_COOLDOWN_MAX_MS, Math.max(0, Math.round(n)));
}

export function clampInviteHoldMs(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(INVITE_HOLD_MAX_MS, Math.max(0, Math.round(n)));
}

export function sharedGateId(code: string, deviceId: string): string {
  return `share:${code}:${deviceId}`;
}

/** PalGate device id — never a local row id like `share:CODE:…`. */
export function palGateDeviceKey(row: {
  deviceId?: string | null;
  id?: string | null;
}): string {
  const deviceId = String(row.deviceId ?? '').trim();
  if (deviceId) return deviceId;
  const id = String(row.id ?? '').trim();
  if (id && !id.startsWith('share:')) return id;
  return '';
}

export function existingPalGateDeviceIds(
  gates: Array<{ deviceId?: string | null; id?: string | null }>,
): Set<string> {
  const out = new Set<string>();
  for (const gate of gates) {
    const key = palGateDeviceKey(gate);
    if (key) out.add(key);
  }
  return out;
}

export type InviteGatePartition = {
  alreadyHave: SharedGatePayload[];
  toAdd: SharedGatePayload[];
};

export function partitionInviteGates(
  invited: SharedGatePayload[],
  existing: Array<{ deviceId?: string | null; id?: string | null }>,
): InviteGatePartition {
  const owned = existingPalGateDeviceIds(existing);
  const alreadyHave: SharedGatePayload[] = [];
  const toAdd: SharedGatePayload[] = [];
  const seen = new Set<string>();
  for (const gate of invited) {
    const key = palGateDeviceKey(gate);
    if (!key || seen.has(key)) {
      if (key && owned.has(key)) alreadyHave.push(gate);
      continue;
    }
    seen.add(key);
    if (owned.has(key)) alreadyHave.push(gate);
    else toAdd.push(gate);
  }
  return { alreadyHave, toAdd };
}

export function inviteDisplayName(gate: SharedGatePayload): string {
  return (
    gate.nameOverride?.trim() || gate.name?.trim() || gate.deviceId || 'Gate'
  );
}

/** Recipients never inherit the sender’s car Bluetooth require list. */
export function shareBluetoothOff(): SharedGatePayload['bluetooth'] {
  return { required: false, devices: [] };
}

/** Clamp a gate for Firestore, stripping Bluetooth-required from the share. */
export function toShareGateMap(gate: SharedGatePayload): SharedGatePayload {
  return {
    ...toInviteGateMap(gate),
    bluetooth: shareBluetoothOff(),
  };
}

export function parseSharedGate(raw: unknown): SharedGatePayload {
  const g = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const credIndex = Number(g.credIndex);
  return {
    deviceId: String(g.deviceId ?? ''),
    name: String(g.name ?? ''),
    nameOverride: typeof g.nameOverride === 'string' ? g.nameOverride : null,
    lat: typeof g.lat === 'number' ? g.lat : null,
    lng: typeof g.lng === 'number' ? g.lng : null,
    radiusMeters: clampInviteRadiusMeters(g.radiusMeters),
    cooldownMs: clampInviteCooldownMs(
      typeof g.cooldownMs === 'number' ? g.cooldownMs : 30_000,
    ),
    holdEnabled: Boolean(g.holdEnabled),
    holdMs: clampInviteHoldMs(g.holdMs),
    bluetooth: {
      required: Boolean(
        g.bluetooth &&
          typeof g.bluetooth === 'object' &&
          (g.bluetooth as { required?: unknown }).required,
      ),
      devices: Array.isArray(
        g.bluetooth && typeof g.bluetooth === 'object'
          ? (g.bluetooth as { devices?: unknown }).devices
          : null,
      )
        ? (
            (g.bluetooth as { devices: Array<{ name?: string; address?: string }> })
              .devices
          ).map((d) => ({
            ...(d.name ? { name: String(d.name) } : {}),
            ...(d.address ? { address: String(d.address) } : {}),
          }))
        : [],
    },
    systemLabel: String(g.systemLabel ?? 'Shared').slice(0, 80),
    credIndex:
      Number.isInteger(credIndex) && credIndex >= 0 && credIndex < INVITE_MAX_PACKS
        ? credIndex
        : 0,
  };
}

/** New invites store `gates[]`; older docs only have `gate`. */
export function inviteGateList(data: {
  gate?: unknown;
  gates?: unknown;
}): SharedGatePayload[] {
  if (Array.isArray(data.gates) && data.gates.length > 0) {
    return data.gates.map(parseSharedGate).slice(0, INVITE_MAX_GATES);
  }
  if (data.gate) return [parseSharedGate(data.gate)];
  return [];
}

const SHARING_PROVIDERS = ['password', 'google.com'];

export function isRealFirebaseAccount(input: {
  isAnonymous: boolean;
  providers: string[];
  email?: string | null;
}): boolean {
  if (input.providers.some((p) => SHARING_PROVIDERS.includes(p))) return true;
  if (input.email?.trim()) return !input.isAnonymous;
  return false;
}

const PLACEHOLDER_NAMES = new Set(['guest', 'signed in']);

function usablePersonName(raw?: string | null): string {
  const name = raw?.trim() ?? '';
  if (!name || PLACEHOLDER_NAMES.has(name.toLowerCase())) return '';
  return name.slice(0, 80);
}

/**
 * Name shown in Settings: signup Name, then Google profile, then cloud.
 * Does not invent the email local-part (that raced over the registered name).
 */
export function resolveRegisteredDisplayName(input: {
  explicit?: string | null;
  authDisplayName?: string | null;
  cloudDisplayName?: string | null;
  googleDisplayName?: string | null;
  email?: string | null;
  isRealAccount: boolean;
}): string {
  const explicit = usablePersonName(input.explicit);
  if (explicit) return explicit;
  const emailLocal = input.email?.split('@')[0]?.trim() ?? '';
  const authName = usablePersonName(input.authDisplayName);
  const cloudName = usablePersonName(input.cloudDisplayName);
  const googleName = usablePersonName(input.googleDisplayName);
  const authIsEmailLocal =
    Boolean(emailLocal) &&
    authName.toLowerCase() === emailLocal.toLowerCase();
  if (cloudName && authIsEmailLocal && cloudName.toLowerCase() !== authName.toLowerCase()) {
    return cloudName;
  }
  if (authName && !authIsEmailLocal) return authName;
  if (cloudName) return cloudName;
  if (googleName) return googleName;
  return input.isRealAccount ? 'Signed in' : 'Guest';
}

/** Settings / share copy: Guest vs Google/email. Ignores a leftover "Guest" name. */
export function accountHeading(input: {
  isRealAccount: boolean;
  displayName: string | null;
  email: string | null;
}): { label: string; detail: string; showUpgrade: boolean } {
  if (!input.isRealAccount) {
    return {
      label: 'Guest',
      detail: 'Local gates only — upgrade to share',
      showUpgrade: true,
    };
  }
  const name = input.displayName?.trim() ?? '';
  const email = input.email?.trim() || null;
  const usableName = name && name.toLowerCase() !== 'guest' ? name : '';
  return {
    label: usableName || email || 'Signed in',
    detail: email || 'Google or email account',
    showUpgrade: false,
  };
}

function clip(value: string, max: number): string {
  return value.slice(0, max);
}

function finiteCoord(raw: unknown, min: number, max: number): number | null {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

/** Clamp a gate map to Firestore invite bounds so 1- and multi-gate writes match rules. */
export function toInviteGateMap(gate: SharedGatePayload): SharedGatePayload {
  const credIndex = Math.floor(Number(gate.credIndex));
  return {
    deviceId: clip(String(gate.deviceId ?? ''), 120),
    name: clip(String(gate.name ?? ''), 120),
    nameOverride:
      gate.nameOverride == null ? null : clip(String(gate.nameOverride), 120) || null,
    lat: finiteCoord(gate.lat, -90, 90),
    lng: finiteCoord(gate.lng, -180, 180),
    radiusMeters: clampInviteRadiusMeters(gate.radiusMeters),
    cooldownMs: clampInviteCooldownMs(gate.cooldownMs),
    holdEnabled: Boolean(gate.holdEnabled),
    holdMs: clampInviteHoldMs(gate.holdMs),
    bluetooth: {
      required: Boolean(gate.bluetooth?.required),
      devices: (gate.bluetooth?.devices ?? []).slice(0, 12).map((d) => ({
        ...(d.name ? { name: clip(String(d.name), 80) } : {}),
        ...(d.address ? { address: clip(String(d.address), 64) } : {}),
      })),
    },
    systemLabel: clip(String(gate.systemLabel || 'Shared'), 80) || 'Shared',
    credIndex:
      Number.isInteger(credIndex) && credIndex >= 0 && credIndex < INVITE_MAX_PACKS
        ? credIndex
        : 0,
  };
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
