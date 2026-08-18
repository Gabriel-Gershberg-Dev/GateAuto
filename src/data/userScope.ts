/**
 * PalGate gates/credentials are stored per Firebase uid so account switch on
 * the same phone cannot inherit the previous user's systems.
 */

const NONE = '_none';
const ACTIVE_UID_KEY = 'gateauto.activeUid';

/** undefined = not hydrated from disk yet */
let activeUid: string | null | undefined;

export const UNSCOPED_ASYNC = {
  gates: 'gateauto.gates',
  systems: 'gateauto.systems.v1',
  monitoring: 'gateauto.monitoringEnabled',
  eventLog: 'gateauto.eventLog',
  openSafety: 'gateauto.openSafetyLock',
  geofenceSyncAt: 'gateauto.lastGeofenceSyncAt',
  monitoringArmedAt: 'gateauto.lastMonitoringArmedAt',
} as const;

export const UNSCOPED_SECURE_LEGACY = {
  s: 'gateauto.sessionToken',
  p: 'gateauto.phoneNumber',
  t: 'gateauto.tokenType',
} as const;

export function sanitizeUid(uid: string | null | undefined): string {
  const cleaned = String(uid ?? '')
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, 64);
  return cleaned || NONE;
}

export function asyncKeyForUid(uid: string | null | undefined, leaf: string): string {
  return `gateauto.u.${sanitizeUid(uid)}.${leaf}`;
}

export function secureKeyForUid(uid: string | null | undefined, leaf: string): string {
  return `ga.${sanitizeUid(uid)}.${leaf}`.slice(0, 120);
}

export function unscopedSystemCredKey(
  systemId: string,
  field: 'session' | 'phone' | 'type',
): string {
  return `gateauto.sys.${systemId}.${field}`;
}

export function systemCredSecureKey(
  systemId: string,
  field: 's' | 'p' | 't',
  uid: string | null | undefined = getActiveUid(),
): string {
  return secureKeyForUid(uid, `sys.${systemId}.${field}`);
}

export function legacySecureKey(
  field: 's' | 'p' | 't',
  uid: string | null | undefined = getActiveUid(),
): string {
  return secureKeyForUid(uid, `legacy.${field}`);
}

export function getActiveUid(): string | null {
  return activeUid ?? null;
}

/** Immediate in-memory switch — do not wait on disk or SecureStore. */
export function setActiveUidInMemory(uid: string | null): void {
  activeUid = uid;
}

export function scopedAsyncKey(leaf: string): string {
  return asyncKeyForUid(getActiveUid(), leaf);
}

export async function persistActiveUid(uid: string | null): Promise<void> {
  activeUid = uid;
  const AsyncStorage = (await import('@react-native-async-storage/async-storage'))
    .default;
  if (uid) await AsyncStorage.setItem(ACTIVE_UID_KEY, uid);
  else await AsyncStorage.removeItem(ACTIVE_UID_KEY);
}

export async function hydrateUserScope(): Promise<string | null> {
  if (activeUid !== undefined) return activeUid;
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage'))
      .default;
    activeUid = await AsyncStorage.getItem(ACTIVE_UID_KEY);
  } catch {
    activeUid = null;
  }
  return activeUid;
}

/**
 * Leftover owner vault (unscoped / other-uid / native regions) may be adopted
 * only by the original Google account or a user who has created shares.
 * Email invitees (pending incoming, or password-only with no outgoing) stay empty.
 */
export function shouldAdoptUnscopedVault(input: {
  isRealAccount: boolean;
  providers?: string[];
  incomingPendingCount: number;
  outgoingCount: number;
}): boolean {
  if (!input.isRealAccount) return false;
  if (input.incomingPendingCount > 0 && input.outgoingCount === 0) return false;
  if (input.outgoingCount > 0) return true;
  const providers = input.providers ?? [];
  return providers.includes('google.com');
}
