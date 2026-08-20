import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TokenType, type PalGateCredentials } from '../palgate/types';
import { writeNativeCredentials } from '../platform/keepAliveAlarm';
import { loadGates, type GateConfig } from './gatesStore';
import {
  mergeAllowedDeviceIds,
  normalizeAllowedDeviceIds,
} from './sharedCatalog';
import {
  hydrateUserScope,
  legacySecureKey,
  scopedAsyncKey,
  systemCredSecureKey,
} from './userScope';

function metaKey(): string {
  return scopedAsyncKey('systems.v1');
}

const STORE_OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

export type PalGateSystemOrigin = 'linked' | 'shared';

export type PalGateSystemMeta = {
  id: string;
  label: string;
  origin: PalGateSystemOrigin;
  /** Same as origin: 'shared' invite vs owner-linked QR. */
  source: PalGateSystemOrigin;
  /** Device ids this shared-in system may expose. Null = full PalGate catalog. */
  allowedDeviceIds: string[] | null;
  createdAt: number;
};

export type PalGateSystem = PalGateSystemMeta & {
  credentials: PalGateCredentials;
};

function credKey(id: string, field: 'session' | 'phone' | 'type'): string {
  const short = field === 'session' ? 's' : field === 'phone' ? 'p' : 't';
  return systemCredSecureKey(id, short);
}

function newSystemId(): string {
  return `sys_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function fingerprint(c: PalGateCredentials): string {
  return `${c.phoneNumber}:${c.sessionToken.toLowerCase()}`;
}

export function labelForCredentials(
  credentials: PalGateCredentials,
  origin: PalGateSystemOrigin,
  index: number,
): string {
  const tail = String(credentials.phoneNumber).slice(-4);
  if (origin === 'shared') return `Shared · ${tail}`;
  if (index <= 1) return tail ? `Your PalGate · ${tail}` : 'Your PalGate';
  return tail ? `Gate system ${index} · ${tail}` : `Gate system ${index}`;
}

function normalizeSystemMeta(
  row: Partial<PalGateSystemMeta> & { id?: string; source?: PalGateSystemOrigin },
): PalGateSystemMeta | null {
  const id = String(row.id ?? '').trim();
  if (!id) return null;
  const origin: PalGateSystemOrigin =
    row.origin === 'shared' || row.source === 'shared' ? 'shared' : 'linked';
  const allowed = normalizeAllowedDeviceIds(row.allowedDeviceIds);
  return {
    id,
    label: String(row.label ?? 'PalGate').slice(0, 80) || 'PalGate',
    origin,
    source: origin,
    allowedDeviceIds: origin === 'shared' ? allowed : null,
    createdAt: Number(row.createdAt) || Date.now(),
  };
}

async function readMeta(): Promise<PalGateSystemMeta[]> {
  await hydrateUserScope();
  const raw = await AsyncStorage.getItem(metaKey());
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as PalGateSystemMeta[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row) => normalizeSystemMeta(row))
      .filter((row): row is PalGateSystemMeta => row != null);
  } catch {
    return [];
  }
}

async function writeMeta(meta: PalGateSystemMeta[]): Promise<void> {
  await hydrateUserScope();
  await AsyncStorage.setItem(metaKey(), JSON.stringify(meta));
}

async function readSystemCreds(id: string): Promise<PalGateCredentials | null> {
  const [sessionToken, phoneRaw, typeRaw] = await Promise.all([
    SecureStore.getItemAsync(credKey(id, 'session'), STORE_OPTS),
    SecureStore.getItemAsync(credKey(id, 'phone'), STORE_OPTS),
    SecureStore.getItemAsync(credKey(id, 'type'), STORE_OPTS),
  ]);
  if (!sessionToken || !phoneRaw || typeRaw == null) return null;
  const phoneNumber = Number(phoneRaw);
  const tokenType = Number(typeRaw) as TokenType;
  if (!Number.isFinite(phoneNumber) || phoneNumber <= 0) return null;
  if (
    tokenType !== TokenType.SMS &&
    tokenType !== TokenType.PRIMARY &&
    tokenType !== TokenType.SECONDARY
  ) {
    return null;
  }
  return { sessionToken, phoneNumber, tokenType };
}

async function writeSystemCreds(
  id: string,
  credentials: PalGateCredentials,
): Promise<void> {
  await SecureStore.setItemAsync(
    credKey(id, 'session'),
    credentials.sessionToken,
    STORE_OPTS,
  );
  await SecureStore.setItemAsync(
    credKey(id, 'phone'),
    String(credentials.phoneNumber),
    STORE_OPTS,
  );
  await SecureStore.setItemAsync(
    credKey(id, 'type'),
    String(credentials.tokenType),
    STORE_OPTS,
  );
}

async function deleteSystemCreds(id: string): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(credKey(id, 'session'), STORE_OPTS),
    SecureStore.deleteItemAsync(credKey(id, 'phone'), STORE_OPTS),
    SecureStore.deleteItemAsync(credKey(id, 'type'), STORE_OPTS),
  ]);
}

async function readLegacy(): Promise<PalGateCredentials | null> {
  await hydrateUserScope();
  const [sessionToken, phoneRaw, typeRaw] = await Promise.all([
    SecureStore.getItemAsync(legacySecureKey('s'), STORE_OPTS),
    SecureStore.getItemAsync(legacySecureKey('p'), STORE_OPTS),
    SecureStore.getItemAsync(legacySecureKey('t'), STORE_OPTS),
  ]);
  if (!sessionToken || !phoneRaw || typeRaw === null) return null;
  const phoneNumber = Number(phoneRaw);
  const tokenType = Number(typeRaw) as TokenType;
  if (!Number.isFinite(phoneNumber)) return null;
  if (
    tokenType !== TokenType.SMS &&
    tokenType !== TokenType.PRIMARY &&
    tokenType !== TokenType.SECONDARY
  ) {
    return null;
  }
  return { sessionToken, phoneNumber, tokenType };
}

async function writeLegacy(credentials: PalGateCredentials | null): Promise<void> {
  await hydrateUserScope();
  if (!credentials) {
    await Promise.all([
      SecureStore.deleteItemAsync(legacySecureKey('s'), STORE_OPTS),
      SecureStore.deleteItemAsync(legacySecureKey('p'), STORE_OPTS),
      SecureStore.deleteItemAsync(legacySecureKey('t'), STORE_OPTS),
    ]);
    return;
  }
  await SecureStore.setItemAsync(
    legacySecureKey('s'),
    credentials.sessionToken,
    STORE_OPTS,
  );
  await SecureStore.setItemAsync(
    legacySecureKey('p'),
    String(credentials.phoneNumber),
    STORE_OPTS,
  );
  await SecureStore.setItemAsync(
    legacySecureKey('t'),
    String(credentials.tokenType),
    STORE_OPTS,
  );
}

async function migrateLegacyIfNeeded(): Promise<void> {
  const meta = await readMeta();
  if (meta.length > 0) return;
  const legacy = await readLegacy();
  if (!legacy) return;
  const id = 'sys_legacy';
  const row: PalGateSystemMeta = {
    id,
    label: labelForCredentials(legacy, 'linked', 1),
    origin: 'linked',
    source: 'linked',
    allowedDeviceIds: null,
    createdAt: Date.now(),
  };
  await writeSystemCreds(id, legacy);
  await writeMeta([row]);
}

export async function listSystems(): Promise<PalGateSystem[]> {
  await migrateLegacyIfNeeded();
  let meta = await readMeta();
  if (
    meta.some(
      (row) =>
        row.origin === 'shared' &&
        (!row.allowedDeviceIds || row.allowedDeviceIds.length === 0),
    )
  ) {
    const gates = await loadGates();
    const sharedCount = meta.filter((row) => row.origin === 'shared').length;
    let dirty = false;
    meta = meta.map((row) => {
      if (
        row.origin !== 'shared' ||
        (row.allowedDeviceIds && row.allowedDeviceIds.length > 0)
      ) {
        return row;
      }
      const ids = normalizeAllowedDeviceIds(
        gates
          .filter(
            (g) =>
              g.origin === 'shared' &&
              (g.systemId === row.id || (!g.systemId && sharedCount === 1)),
          )
          .map((g) => g.deviceId),
      );
      if (ids.length === 0) return row;
      dirty = true;
      return { ...row, allowedDeviceIds: ids };
    });
    if (dirty) await writeMeta(meta);
  }
  const out: PalGateSystem[] = [];
  for (const row of meta) {
    const credentials = await readSystemCreds(row.id);
    if (!credentials) continue;
    out.push({ ...row, credentials });
  }
  return out;
}

export async function listLinkedSystems(): Promise<PalGateSystem[]> {
  return (await listSystems()).filter((s) => s.origin === 'linked');
}

export async function getSystem(id: string): Promise<PalGateSystem | null> {
  const all = await listSystems();
  return all.find((s) => s.id === id) ?? null;
}

export async function hasAnySystem(): Promise<boolean> {
  const all = await listSystems();
  return all.length > 0;
}

/** True only if this account scanned a PalGate QR (owner-linked). */
export async function hasLinkedOwnerSystem(): Promise<boolean> {
  return (await listLinkedSystems()).length > 0;
}

/**
 * Drop shared-in PalGate systems that no longer have any gates.
 * Never removes an owner-linked (QR) system.
 */
export async function pruneUnusedSharedSystems(): Promise<void> {
  const [systems, gates] = await Promise.all([listSystems(), loadGates()]);
  const used = new Set(
    gates.map((g) => g.systemId).filter((id): id is string => Boolean(id)),
  );
  for (const sys of systems) {
    if (sys.origin !== 'shared') continue;
    if (used.has(sys.id)) continue;
    await removeSystem(sys.id);
  }
}

export type UpsertSystemOptions = {
  origin?: PalGateSystemOrigin;
  label?: string;
  allowedDeviceIds?: string[] | null;
};

/**
 * Add or reuse a PalGate credential set. Same phone+token updates the existing
 * system instead of duplicating. A share must not demote an owner-linked
 * (QR-scanned) PalGate to shared-in — catalog refresh stays owner-only.
 */
export async function upsertSystem(
  credentials: PalGateCredentials,
  options?: UpsertSystemOptions,
): Promise<PalGateSystem> {
  await migrateLegacyIfNeeded();
  const origin = options?.origin ?? 'linked';
  const incomingAllow =
    origin === 'shared'
      ? normalizeAllowedDeviceIds(options?.allowedDeviceIds)
      : [];
  const existing = await listSystems();
  const fp = fingerprint(credentials);
  const match = existing.find((s) => fingerprint(s.credentials) === fp);
  if (match) {
    let nextOrigin: PalGateSystemOrigin = match.origin;
    let nextAllow = match.allowedDeviceIds;
    if (origin === 'linked') {
      nextOrigin = 'linked';
      nextAllow = null;
    } else if (match.origin === 'linked') {
      nextOrigin = 'linked';
      nextAllow = null;
    } else {
      nextOrigin = 'shared';
      nextAllow = mergeAllowedDeviceIds(match.allowedDeviceIds, incomingAllow);
    }
    await writeSystemCreds(match.id, credentials);
    const nextMeta = (await readMeta()).map((row) =>
      row.id === match.id
        ? {
            ...row,
            origin: nextOrigin,
            source: nextOrigin,
            allowedDeviceIds: nextOrigin === 'shared' ? nextAllow : null,
            label: options?.label?.trim() || row.label,
          }
        : row,
    );
    await writeMeta(nextMeta);
    const updated: PalGateSystem = {
      ...match,
      credentials,
      origin: nextOrigin,
      source: nextOrigin,
      allowedDeviceIds: nextOrigin === 'shared' ? nextAllow : null,
      label: options?.label?.trim() || match.label,
    };
    await syncNativeFromSystems();
    void import('./accountSync')
      .then((m) => m.scheduleCloudPush())
      .catch(() => undefined);
    return updated;
  }

  const id = newSystemId();
  const linkedCount = existing.filter((s) => s.origin === 'linked').length;
  const label =
    options?.label?.trim() ||
    labelForCredentials(credentials, origin, linkedCount + 1);
  const row: PalGateSystemMeta = {
    id,
    label,
    origin,
    source: origin,
    allowedDeviceIds: origin === 'shared' ? incomingAllow : null,
    createdAt: Date.now(),
  };
  await writeSystemCreds(id, credentials);
  await writeMeta([...existing.map(({ credentials: _c, ...m }) => m), row]);
  await syncNativeFromSystems();
  void import('./accountSync')
    .then((m) => m.scheduleCloudPush())
    .catch(() => undefined);
  return { ...row, credentials };
}

export async function removeSystem(systemId: string): Promise<void> {
  const meta = (await readMeta()).filter((row) => row.id !== systemId);
  await deleteSystemCreds(systemId);
  await writeMeta(meta);
  await syncNativeFromSystems();
  void import('./accountSync')
    .then((m) => m.scheduleCloudPush())
    .catch(() => undefined);
}

export async function restoreSystems(rows: PalGateSystem[]): Promise<void> {
  const meta: PalGateSystemMeta[] = rows
    .map((row) => {
      const { credentials: _c, ...rest } = row;
      return normalizeSystemMeta(rest);
    })
    .filter((row): row is PalGateSystemMeta => row != null);
  await writeMeta(meta);
  for (const row of rows) {
    await writeSystemCreds(row.id, row.credentials);
  }
  await syncNativeFromSystems();
}

export async function clearAllSystems(): Promise<void> {
  const meta = await readMeta();
  await Promise.all(meta.map((row) => deleteSystemCreds(row.id)));
  await writeMeta([]);
  await writeLegacy(null);
  await writeNativeCredentials(null);
  const { writeNativeGateCredentialsJson } = await import(
    '../platform/keepAliveAlarm'
  );
  await writeNativeGateCredentialsJson('{}');
  void import('./accountSync')
    .then((m) => m.scheduleCloudPush())
    .catch(() => undefined);
}

export async function loadCredentialsForSystem(
  systemId: string | null | undefined,
): Promise<PalGateCredentials | null> {
  if (!systemId) {
    const linked = await listLinkedSystems();
    return linked[0]?.credentials ?? (await readLegacy());
  }
  const sys = await getSystem(systemId);
  return sys?.credentials ?? null;
}

export async function loadCredentialsForGate(
  gate: Pick<GateConfig, 'id' | 'systemId' | 'origin'>,
): Promise<PalGateCredentials | null> {
  if (gate.systemId) {
    const direct = await loadCredentialsForSystem(gate.systemId);
    if (direct) return direct;
  }
  const linked = await listLinkedSystems();
  return linked[0]?.credentials ?? (await readLegacy());
}

export async function primaryCredentials(): Promise<PalGateCredentials | null> {
  const linked = await listLinkedSystems();
  if (linked[0]) return linked[0].credentials;
  return readLegacy();
}

export async function syncNativeFromSystems(): Promise<void> {
  const systems = await listSystems();
  // Shared-in creds open those devices (per-gate map) but must never become
  // the phone's primary PalGate catalog token.
  const primary = systems.find((s) => s.origin === 'linked') ?? null;
  await writeLegacy(primary?.credentials ?? null);
  await writeNativeCredentials(primary?.credentials ?? null);

  const gates = await loadGates();
  const map: Record<
    string,
    { sessionToken: string; phoneNumber: number; tokenType: number }
  > = {};
  for (const gate of gates) {
    const creds = gate.systemId
      ? ((await getSystem(gate.systemId))?.credentials ?? null)
      : primary?.credentials ?? null;
    if (!creds) continue;
    map[gate.id] = {
      sessionToken: creds.sessionToken,
      phoneNumber: creds.phoneNumber,
      tokenType: creds.tokenType,
    };
  }
  const { writeNativeGateCredentialsJson } = await import(
    '../platform/keepAliveAlarm'
  );
  await writeNativeGateCredentialsJson(JSON.stringify(map));
}
