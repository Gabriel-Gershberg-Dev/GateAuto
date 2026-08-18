import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import {
  UNSCOPED_ASYNC,
  UNSCOPED_SECURE_LEGACY,
  asyncKeyForUid,
  getActiveUid,
  legacySecureKey,
  persistActiveUid,
  setActiveUidInMemory,
  shouldAdoptUnscopedVault,
  systemCredSecureKey,
  unscopedSystemCredKey,
} from './userScope';

const STORE_OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

async function copyAsync(from: string, to: string): Promise<void> {
  const raw = await AsyncStorage.getItem(from);
  if (raw == null) return;
  const dest = await AsyncStorage.getItem(to);
  if (dest != null && dest !== '' && dest !== '[]' && dest !== '{}') return;
  await AsyncStorage.setItem(to, raw);
}

async function copySecure(from: string, to: string): Promise<void> {
  const raw = await SecureStore.getItemAsync(from, STORE_OPTS);
  if (raw == null) return;
  const dest = await SecureStore.getItemAsync(to, STORE_OPTS);
  if (dest) return;
  await SecureStore.setItemAsync(to, raw, STORE_OPTS);
}

async function deleteSecure(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key, STORE_OPTS).catch(() => undefined);
}

async function unscopedVaultExists(): Promise<boolean> {
  const [gates, systems] = await Promise.all([
    AsyncStorage.getItem(UNSCOPED_ASYNC.gates),
    AsyncStorage.getItem(UNSCOPED_ASYNC.systems),
  ]);
  const hasGates = Boolean(gates && gates !== '[]');
  const hasSystems = Boolean(systems && systems !== '[]');
  if (hasGates || hasSystems) return true;
  const legacy = await SecureStore.getItemAsync(UNSCOPED_SECURE_LEGACY.s, STORE_OPTS);
  return Boolean(legacy);
}

async function moveUnscopedVaultToUid(uid: string): Promise<void> {
  await copyAsync(UNSCOPED_ASYNC.gates, asyncKeyForUid(uid, 'gates'));
  await copyAsync(UNSCOPED_ASYNC.systems, asyncKeyForUid(uid, 'systems.v1'));
  await copyAsync(UNSCOPED_ASYNC.monitoring, asyncKeyForUid(uid, 'monitoringEnabled'));
  await copyAsync(UNSCOPED_ASYNC.eventLog, asyncKeyForUid(uid, 'eventLog'));
  await copyAsync(UNSCOPED_ASYNC.openSafety, asyncKeyForUid(uid, 'openSafetyLock'));
  await copyAsync(
    UNSCOPED_ASYNC.geofenceSyncAt,
    asyncKeyForUid(uid, 'lastGeofenceSyncAt'),
  );
  await copyAsync(
    UNSCOPED_ASYNC.monitoringArmedAt,
    asyncKeyForUid(uid, 'lastMonitoringArmedAt'),
  );

  const metaRaw = await AsyncStorage.getItem(UNSCOPED_ASYNC.systems);
  let ids: string[] = [];
  if (metaRaw) {
    try {
      const parsed = JSON.parse(metaRaw) as Array<{ id?: string }>;
      if (Array.isArray(parsed)) {
        ids = parsed.map((row) => String(row.id ?? '')).filter(Boolean);
      }
    } catch {
      ids = [];
    }
  }

  for (const id of ids) {
    await copySecure(
      unscopedSystemCredKey(id, 'session'),
      systemCredSecureKey(id, 's', uid),
    );
    await copySecure(
      unscopedSystemCredKey(id, 'phone'),
      systemCredSecureKey(id, 'p', uid),
    );
    await copySecure(
      unscopedSystemCredKey(id, 'type'),
      systemCredSecureKey(id, 't', uid),
    );
  }

  await copySecure(UNSCOPED_SECURE_LEGACY.s, legacySecureKey('s', uid));
  await copySecure(UNSCOPED_SECURE_LEGACY.p, legacySecureKey('p', uid));
  await copySecure(UNSCOPED_SECURE_LEGACY.t, legacySecureKey('t', uid));

  await AsyncStorage.multiRemove([
    UNSCOPED_ASYNC.gates,
    UNSCOPED_ASYNC.systems,
    UNSCOPED_ASYNC.monitoring,
    UNSCOPED_ASYNC.eventLog,
    UNSCOPED_ASYNC.openSafety,
    UNSCOPED_ASYNC.geofenceSyncAt,
    UNSCOPED_ASYNC.monitoringArmedAt,
  ]);

  for (const id of ids) {
    await deleteSecure(unscopedSystemCredKey(id, 'session'));
    await deleteSecure(unscopedSystemCredKey(id, 'phone'));
    await deleteSecure(unscopedSystemCredKey(id, 'type'));
  }
  await deleteSecure(UNSCOPED_SECURE_LEGACY.s);
  await deleteSecure(UNSCOPED_SECURE_LEGACY.p);
  await deleteSecure(UNSCOPED_SECURE_LEGACY.t);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return Promise.race([
    promise.then((v) => v, () => 'timeout' as const),
    new Promise<'timeout'>((resolve) => {
      setTimeout(() => resolve('timeout'), ms);
    }),
  ]);
}

/**
 * Copy pre-uid local PalGate data onto this uid when they are the owner.
 * Invitees with pending incoming shares start empty (pending UI unchanged).
 */
export async function maybeAdoptUnscopedVault(input: {
  isRealAccount: boolean;
}): Promise<boolean> {
  const uid = getActiveUid();
  if (!uid) return false;
  if (!(await unscopedVaultExists())) return false;

  let incomingPendingCount = 0;
  let outgoingCount = 0;
  try {
    const { listIncomingPendingInvites, listOutgoingInvites } = await import(
      '../share/invites'
    );
    incomingPendingCount = (await listIncomingPendingInvites()).length;
    outgoingCount = (await listOutgoingInvites()).length;
  } catch {
    return false;
  }

  if (
    !shouldAdoptUnscopedVault({
      isRealAccount: input.isRealAccount,
      incomingPendingCount,
      outgoingCount,
    })
  ) {
    return false;
  }

  const result = await withTimeout(moveUnscopedVaultToUid(uid), 2000);
  return result !== 'timeout';
}

/** Stop auto-open for the signed-out session without blocking navigation. */
export function disarmNativeSession(): void {
  void (async () => {
    try {
      const {
        setNativeKeepAliveArmed,
        writeNativeCredentials,
        writeNativeGateCredentialsJson,
      } = await import('../platform/keepAliveAlarm');
      await setNativeKeepAliveArmed(false);
      await writeNativeCredentials(null);
      await writeNativeGateCredentialsJson('{}');
    } catch {
      // Native keepalive must never block sign-out.
    }
    try {
    const { tryStopGeofencing } = await import('../integrations/optionalNative');
    await withTimeout(tryStopGeofencing(), 1500);
  } catch {
    // OS geofence stop can hang; UI already left this account.
  }
  try {
    const { resetGeofenceSessionMemory } = await import('../geo/geofencing');
    resetGeofenceSessionMemory();
  } catch {
    // ignore
  }
})();
}

export async function activateAccountVault(uid: string | null): Promise<void> {
  setActiveUidInMemory(uid);
  await persistActiveUid(uid);
  void import('../geo/geofencing')
    .then((m) => m.resetGeofenceSessionMemory())
    .catch(() => undefined);
}

export function leaveAccountVault(): void {
  setActiveUidInMemory(null);
  void persistActiveUid(null);
  disarmNativeSession();
}
