import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TokenType, type PalGateCredentials } from '../palgate/types';
import { writeNativeCredentials } from '../platform/keepAliveAlarm';
import { loadGates, type GateConfig } from './gatesStore';

const META_KEY = 'gateauto.systems.v1';
const LEGACY = {
  sessionToken: 'gateauto.sessionToken',
  phoneNumber: 'gateauto.phoneNumber',
  tokenType: 'gateauto.tokenType',
} as const;

const STORE_OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

export type PalGateSystemOrigin = 'linked' | 'shared';

export type PalGateSystemMeta = {
  id: string;
  label: string;
  origin: PalGateSystemOrigin;
  createdAt: number;
};

export type PalGateSystem = PalGateSystemMeta & {
  credentials: PalGateCredentials;
};

function credKey(id: string, field: 'session' | 'phone' | 'type'): string {
  return `gateauto.sys.${id}.${field}`;
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

async function readMeta(): Promise<PalGateSystemMeta[]> {
  const raw = await AsyncStorage.getItem(META_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as PalGateSystemMeta[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeMeta(meta: PalGateSystemMeta[]): Promise<void> {
  await AsyncStorage.setItem(META_KEY, JSON.stringify(meta));
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
  const [sessionToken, phoneRaw, typeRaw] = await Promise.all([
    SecureStore.getItemAsync(LEGACY.sessionToken, STORE_OPTS),
    SecureStore.getItemAsync(LEGACY.phoneNumber, STORE_OPTS),
    SecureStore.getItemAsync(LEGACY.tokenType, STORE_OPTS),
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
  if (!credentials) {
    await Promise.all([
      SecureStore.deleteItemAsync(LEGACY.sessionToken, STORE_OPTS),
      SecureStore.deleteItemAsync(LEGACY.phoneNumber, STORE_OPTS),
      SecureStore.deleteItemAsync(LEGACY.tokenType, STORE_OPTS),
    ]);
    return;
  }
  await SecureStore.setItemAsync(
    LEGACY.sessionToken,
    credentials.sessionToken,
    STORE_OPTS,
  );
  await SecureStore.setItemAsync(
    LEGACY.phoneNumber,
    String(credentials.phoneNumber),
    STORE_OPTS,
  );
  await SecureStore.setItemAsync(
    LEGACY.tokenType,
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
    createdAt: Date.now(),
  };
  await writeSystemCreds(id, legacy);
  await writeMeta([row]);
}

export async function listSystems(): Promise<PalGateSystem[]> {
  await migrateLegacyIfNeeded();
  const meta = await readMeta();
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

/**
 * Add or reuse a PalGate credential set. Same phone+token updates the existing
 * system instead of duplicating.
 */
export async function upsertSystem(
  credentials: PalGateCredentials,
  options?: { origin?: PalGateSystemOrigin; label?: string },
): Promise<PalGateSystem> {
  await migrateLegacyIfNeeded();
  const origin = options?.origin ?? 'linked';
  const existing = await listSystems();
  const fp = fingerprint(credentials);
  const match = existing.find((s) => fingerprint(s.credentials) === fp);
  if (match) {
    await writeSystemCreds(match.id, credentials);
    const nextMeta = (await readMeta()).map((row) =>
      row.id === match.id
        ? {
            ...row,
            label: options?.label?.trim() || row.label,
          }
        : row,
    );
    await writeMeta(nextMeta);
    const updated = { ...match, credentials, label: options?.label?.trim() || match.label };
    await syncNativeFromSystems();
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
    createdAt: Date.now(),
  };
  await writeSystemCreds(id, credentials);
  await writeMeta([...existing.map(({ credentials: _c, ...m }) => m), row]);
  await syncNativeFromSystems();
  return { ...row, credentials };
}

export async function removeSystem(systemId: string): Promise<void> {
  const meta = (await readMeta()).filter((row) => row.id !== systemId);
  await deleteSystemCreds(systemId);
  await writeMeta(meta);
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
  const primary =
    systems.find((s) => s.origin === 'linked') ?? systems[0] ?? null;
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
