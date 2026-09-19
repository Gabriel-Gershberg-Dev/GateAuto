/**
 * Executable spec for the native car-Bluetooth cache.
 *
 * The cache itself lives in
 * `src/platform/android-keepalive/CarBluetoothState.java`, because the only
 * place it matters is the native open path that runs while the phone is locked
 * and JS is not running. These functions mirror the decisions worth pinning
 * down — how a cached device set answers "is the car connected?", and when a
 * negative answer is trustworthy enough to block an open — so
 * `tests/carBluetoothCache.test.ts` can cover them and fail if the Java drifts.
 *
 * Why a cache at all: reading A2DP/HEADSET connected devices needs an async
 * `BluetoothProfile` proxy whose callback is delivered on the main looper. A
 * cold, locked-phone geofence wake has a busy main looper, so waiting for that
 * callback inside the open path either stalls the open or times out and looks
 * exactly like "car not connected" — which silently blocked the open. The
 * proxies are therefore bound once when monitoring arms and kept bound, ACL
 * connect/disconnect broadcasts keep the set exact in between, and the open
 * path only ever reads what is already there.
 */

/** Matches CarBluetoothState.SEED_TTL_MS in the Java. */
export const CAR_BT_SEED_TTL_MS = 6 * 60 * 60_000;

export type CarBtCacheEntry = {
  /** Normalized address when known, otherwise the lowercased name. */
  key: string;
  name?: string;
};

export type CarBtRead = {
  /** BLUETOOTH_CONNECT granted (Android 12+ reads come back empty without it). */
  connectGranted: boolean;
  /** The Bluetooth adapter exists and is on. */
  adapterEnabled: boolean;
  /**
   * A full profile read has happened at least once, so an empty set really
   * means "nothing connected" rather than "never looked".
   */
  seeded: boolean;
  /** Age of that full read. Ignored when `seeded` is false. */
  seedAgeMs: number;
  /** Currently-connected devices as last observed. */
  devices: CarBtCacheEntry[];
};

export type CarBtState = 'connected' | 'not_connected' | 'unknown';

export type CarBtWanted = {
  /** Normalized (colon-free, lowercase) addresses of the listed cars. */
  addresses: string[];
  /** Lowercased names of the listed cars. */
  names: string[];
};

export function normalizeBtAddress(raw: string | null | undefined): string {
  return (raw ?? '').replace(/[:-]/g, '').toLowerCase();
}

export function normalizeBtName(raw: string | null | undefined): string {
  return (raw ?? '').trim().toLowerCase();
}

/**
 * Whether any listed car (address OR name) is in the cached device set. A cache
 * entry keyed by name only — a device whose address could not be read — still
 * matches a listed name.
 */
export function cacheHasListedCar(
  devices: CarBtCacheEntry[],
  wanted: CarBtWanted,
): boolean {
  const addresses = new Set(wanted.addresses.map(normalizeBtAddress));
  const names = new Set(wanted.names.map(normalizeBtName));
  addresses.delete('');
  names.delete('');
  return devices.some((device) => {
    const key = normalizeBtName(device.key);
    if (addresses.has(key) || names.has(key)) return true;
    const name = normalizeBtName(device.name);
    return name.length > 0 && names.has(name);
  });
}

/**
 * Tri-state car-BT answer for a BT-required gate, mirroring
 * CarBluetoothState.match.
 *
 * The asymmetry is deliberate and is the whole safety property: a *positive*
 * match is trusted immediately, but a *negative* one — the answer that blocks
 * an open — is only trusted when the set is known to be complete and recent.
 * Anything else is `unknown`, and callers fall open on proximity rather than
 * refuse to open the gate, so a Bluetooth read problem can never again stop the
 * car from getting in.
 */
export function resolveCarBtState(
  read: CarBtRead,
  wanted: CarBtWanted,
  ttlMs: number = CAR_BT_SEED_TTL_MS,
): CarBtState {
  // Android 12+ returns empty lists without BLUETOOTH_CONNECT, which is
  // indistinguishable from "car not connected".
  if (!read.connectGranted) return 'unknown';
  // Bluetooth is off, so the car cannot be connected over it. That is a real
  // answer, not a failed read, and it outranks anything still in the cache.
  if (!read.adapterEnabled) return 'not_connected';
  if (cacheHasListedCar(read.devices, wanted)) return 'connected';
  if (read.seeded && read.seedAgeMs >= 0 && read.seedAgeMs <= ttlMs) {
    return 'not_connected';
  }
  return 'unknown';
}

/** Whether a BT-required gate may open given the tri-state read. */
export function carBtAllowsOpen(state: CarBtState): boolean {
  return state !== 'not_connected';
}

/**
 * Fold an ACL / profile connect into the cached set. Adding a device is
 * positive evidence on its own, so it does not need a seed behind it.
 */
export function withConnectedDevice(
  devices: CarBtCacheEntry[],
  device: CarBtCacheEntry,
): CarBtCacheEntry[] {
  const key = normalizeBtName(device.key);
  if (!key) return devices;
  const next = devices.filter((d) => normalizeBtName(d.key) !== key);
  next.push({ key, name: device.name });
  return next;
}

/** Fold an ACL / profile disconnect into the cached set. */
export function withoutDisconnectedDevice(
  devices: CarBtCacheEntry[],
  key: string,
): CarBtCacheEntry[] {
  const normalized = normalizeBtName(key);
  if (!normalized) return devices;
  return devices.filter((d) => normalizeBtName(d.key) !== normalized);
}
