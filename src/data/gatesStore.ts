import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_COOLDOWN_MS,
  normalizeCooldownMs,
} from './cooldownNormalize';
import { moveById } from './gateOrder';
import {
  defaultBluetooth,
  normalizeBluetooth,
  type GateBluetoothConfig,
} from './gateBluetooth';
import { hydrateUserScope, scopedAsyncKey } from './userScope';
import { filterDevicesForSystem, isSharedOrigin } from './sharedCatalog';

export {
  DEFAULT_COOLDOWN_MS,
  DEFAULT_COOLDOWN_SECONDS,
  normalizeCooldownMs,
} from './cooldownNormalize';
export { displayGateName } from './gateDisplay';
export {
  normalizeBluetooth,
  type GateBluetoothConfig,
  type GateBluetoothDevice,
} from './gateBluetooth';

function gatesKey(): string {
  return scopedAsyncKey('gates');
}

function monitoringKey(): string {
  return scopedAsyncKey('monitoringEnabled');
}

export const DEFAULT_RADIUS_METERS = 50;
export const MIN_RADIUS_METERS = 25;
export const MAX_RADIUS_METERS = 150;

export type GateOrigin = 'linked' | 'shared';

export type GateConfig = {
  /** Stable id — usually the PalGate deviceId (may include `:outputNum`). */
  id: string;
  deviceId: string;
  /** PalGate system this gate opens with. */
  systemId: string | null;
  origin: GateOrigin;
  /** Invite code if this row was accepted from a share. */
  sharedInviteCode: string | null;
  sharedFromName: string | null;
  /** Latest human-readable name from PalGate (refreshed on sync). */
  name: string;
  /** Optional user rename; when set, UI prefers this over `name`. */
  nameOverride: string | null;
  enabled: boolean;
  lat: number | null;
  lng: number | null;
  radiusMeters: number;
  cooldownMs: number;
  bluetooth: GateBluetoothConfig;
  lastOpenedAt: number | null;
  /** Short label for list UI (e.g. opened / error / skipped). */
  lastResult: string | null;
};

export type DeviceSummary = {
  deviceId: string;
  name: string;
};

export function createDefaultGate(
  device: DeviceSummary,
  systemId?: string | null,
): GateConfig {
  return {
    id: device.deviceId,
    deviceId: device.deviceId,
    systemId: systemId?.trim() || null,
    origin: 'linked',
    sharedInviteCode: null,
    sharedFromName: null,
    name: device.name || device.deviceId,
    nameOverride: null,
    enabled: false,
    lat: null,
    lng: null,
    radiusMeters: DEFAULT_RADIUS_METERS,
    cooldownMs: DEFAULT_COOLDOWN_MS,
    bluetooth: defaultBluetooth(),
    lastOpenedAt: null,
    lastResult: null,
  };
}

/**
 * Detect multi-output devices (homebridge-palgate `detectMultiOutputDevices`).
 * Empty array => single-output (plain deviceId).
 */
function detectMultiOutputDevices(
  deviceData: Record<string, unknown>,
): Array<{ outputNum: number; name: string | null }> {
  let totalOutputs = 0;
  while (deviceData[`output${totalOutputs + 1}`] !== undefined) {
    totalOutputs++;
  }
  if (totalOutputs <= 1) return [];

  const outputs: Array<{ outputNum: number; name: string | null }> = [];
  for (let outputNum = 1; outputNum <= totalOutputs; outputNum++) {
    if (deviceData[`output${outputNum}`] === true) {
      const raw = deviceData[`name${outputNum}`];
      const name =
        typeof raw === 'string' && raw.trim() ? raw.trim() : null;
      outputs.push({ outputNum, name });
    }
  }
  return outputs;
}

/** homebridge-palgate `generateGateEntries` */
function generateGateEntries(
  deviceId: string,
  outputs: Array<{ outputNum: number; name: string | null }>,
  defaultName: string,
): DeviceSummary[] {
  if (outputs.length === 0) {
    return [{ deviceId, name: defaultName }];
  }
  return outputs.map(({ outputNum, name }) => {
    const gateDeviceId = `${deviceId}:${outputNum}`;
    const gateName =
      name ||
      (defaultName ? `${defaultName} - Output ${outputNum}` : `Output ${outputNum}`);
    return { deviceId: gateDeviceId, name: gateName };
  });
}

function pickDeviceId(d: Record<string, unknown>): string {
  return String(d.id ?? d._id ?? d.deviceId ?? d.device_id ?? '').trim();
}

function pickDefaultName(d: Record<string, unknown>, deviceId: string): string {
  const candidates = [d.name1, d.name, d.nickname, d.deviceName];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return deviceId;
}

/** Parse PalGate `devices` payload into a flat list (shape varies by API version). */
export function parseDevicesResponse(raw: unknown): DeviceSummary[] {
  if (!raw || typeof raw !== 'object') return [];

  const root = raw as Record<string, unknown>;
  const candidates: unknown[] = [];

  if (Array.isArray(root.devices)) candidates.push(...root.devices);
  else if (Array.isArray(root.data)) candidates.push(...root.data);
  else if (
    root.data &&
    typeof root.data === 'object' &&
    Array.isArray((root.data as { devices?: unknown }).devices)
  ) {
    candidates.push(...((root.data as { devices: unknown[] }).devices));
  } else if (Array.isArray(raw)) {
    candidates.push(...raw);
  }

  const out: DeviceSummary[] = [];
  for (const item of candidates) {
    if (!item || typeof item !== 'object') continue;
    const d = item as Record<string, unknown>;
    const deviceId = pickDeviceId(d);
    if (!deviceId) continue;
    const defaultName = pickDefaultName(d, deviceId);
    const outputs = detectMultiOutputDevices(d);
    out.push(...generateGateEntries(deviceId, outputs, defaultName));
  }
  return out;
}

export async function loadGates(): Promise<GateConfig[]> {
  await hydrateUserScope();
  const raw = await AsyncStorage.getItem(gatesKey());
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as GateConfig[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeGate);
  } catch {
    return [];
  }
}

export async function saveGates(gates: GateConfig[]): Promise<void> {
  await hydrateUserScope();
  await AsyncStorage.setItem(gatesKey(), JSON.stringify(gates.map(normalizeGate)));
  void import('./accountSync')
    .then((m) => m.scheduleCloudPush())
    .catch(() => undefined);
}

export async function upsertGate(gate: GateConfig): Promise<GateConfig[]> {
  const gates = await loadGates();
  const next = normalizeGate(gate);
  const idx = gates.findIndex((g) => g.id === next.id);
  if (idx >= 0) gates[idx] = next;
  else gates.push(next);
  await saveGates(gates);
  return gates;
}

export async function setGateEnabled(
  gateId: string,
  enabled: boolean,
): Promise<GateConfig[]> {
  const gates = await loadGates();
  const idx = gates.findIndex((g) => g.id === gateId);
  if (idx < 0) return gates;
  gates[idx] = { ...gates[idx], enabled };
  await saveGates(gates);
  return gates;
}

function migrateNameOverride(
  prev: GateConfig,
  apiName: string,
  deviceId: string,
): string | null {
  if (prev.nameOverride?.trim()) return prev.nameOverride.trim();
  const prevName = prev.name?.trim();
  if (!prevName) return null;
  // Preserve a prior custom rename that wasn't just the device id / fresh API name.
  if (
    prevName !== apiName &&
    prevName !== deviceId &&
    prevName !== prev.deviceId &&
    prevName !== prev.id
  ) {
    return prevName;
  }
  return null;
}

export type MergeDevicesOptions = {
  systemId?: string | null;
  origin?: GateOrigin;
  allowedDeviceIds?: string[] | null;
  /** Owner QR catalog may add new PalGate rows. Shared-in must never. */
  adoptNewDevices?: boolean;
};

function markSeen(seen: Set<string>, gate: Pick<GateConfig, 'id' | 'deviceId'>): void {
  seen.add(gate.id);
  if (gate.deviceId) seen.add(gate.deviceId);
}

/**
 * Merge a PalGate device list into stored gates. Shared-in rows keep invite
 * display names and are never expanded to the owner's full PalGate catalog.
 */
export function mergeDevicesIntoGateList(
  existing: GateConfig[],
  devices: DeviceSummary[],
  options?: MergeDevicesOptions,
): GateConfig[] {
  const origin: GateOrigin = options?.origin === 'shared' ? 'shared' : 'linked';
  const adoptNew =
    options?.adoptNewDevices ?? !isSharedOrigin(origin);
  const filtered = filterDevicesForSystem(devices, {
    origin,
    allowedDeviceIds: options?.allowedDeviceIds,
  });
  const incoming = new Map(filtered.map((d) => [d.deviceId, d]));
  const merged: GateConfig[] = [];
  const seen = new Set<string>();
  const sid = options?.systemId?.trim() || null;

  for (const prev of existing) {
    if (
      prev.origin === 'shared' ||
      (sid && prev.systemId && prev.systemId !== sid)
    ) {
      merged.push(prev);
      markSeen(seen, prev);
      continue;
    }
    const sameSystem = !sid || !prev.systemId || prev.systemId === sid;
    const device = sameSystem
      ? incoming.get(prev.id) ?? incoming.get(prev.deviceId)
      : undefined;
    if (device) {
      const apiName = device.name || device.deviceId;
      merged.push({
        ...prev,
        systemId: prev.systemId || sid,
        origin: prev.origin ?? 'linked',
        deviceId: device.deviceId,
        name: apiName,
        nameOverride: migrateNameOverride(prev, apiName, device.deviceId),
      });
      markSeen(seen, { id: prev.id, deviceId: device.deviceId });
    } else {
      merged.push(prev);
      markSeen(seen, prev);
    }
  }

  if (adoptNew) {
    for (const device of filtered) {
      if (seen.has(device.deviceId)) continue;
      merged.push(createDefaultGate(device, sid));
      markSeen(seen, { id: device.deviceId, deviceId: device.deviceId });
    }
  }

  return merged;
}

export async function mergeDevicesIntoGates(
  devices: DeviceSummary[],
  systemIdOrOptions?: string | null | MergeDevicesOptions,
): Promise<GateConfig[]> {
  const options: MergeDevicesOptions =
    systemIdOrOptions && typeof systemIdOrOptions === 'object'
      ? systemIdOrOptions
      : { systemId: systemIdOrOptions };
  const merged = mergeDevicesIntoGateList(await loadGates(), devices, options);
  await saveGates(merged);
  return merged;
}

export async function moveGate(
  gateId: string,
  direction: 'up' | 'down',
): Promise<GateConfig[]> {
  const gates = await loadGates();
  const next = moveById(gates, gateId, direction);
  if (next === gates) return gates;
  await saveGates(next);
  return next;
}

export async function getGate(gateId: string): Promise<GateConfig | null> {
  const gates = await loadGates();
  return gates.find((g) => g.id === gateId) ?? null;
}

export async function removeGate(gateId: string): Promise<GateConfig[]> {
  const gates = await loadGates();
  const next = gates.filter((g) => g.id !== gateId);
  if (next.length === gates.length) return gates;
  await saveGates(next);
  return next;
}

export async function isMonitoringEnabled(): Promise<boolean> {
  await hydrateUserScope();
  const raw = await AsyncStorage.getItem(monitoringKey());
  return raw === '1' || raw === 'true';
}

export async function setMonitoringEnabled(enabled: boolean): Promise<void> {
  await hydrateUserScope();
  await AsyncStorage.setItem(monitoringKey(), enabled ? '1' : '0');
}

function normalizeGate(gate: Partial<GateConfig> & { deviceId?: string }): GateConfig {
  const deviceId = String(gate.deviceId ?? gate.id ?? '').trim();
  const id = String(gate.id ?? deviceId).trim() || deviceId;
  const radius = Number(gate.radiusMeters);
  const overrideRaw = gate.nameOverride;
  const nameOverride =
    typeof overrideRaw === 'string' && overrideRaw.trim()
      ? overrideRaw.trim()
      : null;

  const origin: GateOrigin = gate.origin === 'shared' ? 'shared' : 'linked';
  const systemId =
    typeof gate.systemId === 'string' && gate.systemId.trim()
      ? gate.systemId.trim()
      : null;
  const sharedInviteCode =
    typeof gate.sharedInviteCode === 'string' && gate.sharedInviteCode.trim()
      ? gate.sharedInviteCode.trim()
      : null;
  const sharedFromName =
    typeof gate.sharedFromName === 'string' && gate.sharedFromName.trim()
      ? gate.sharedFromName.trim()
      : null;

  return {
    id,
    deviceId,
    systemId,
    origin,
    sharedInviteCode,
    sharedFromName,
    name: String(gate.name ?? deviceId),
    nameOverride,
    enabled: Boolean(gate.enabled),
    lat: typeof gate.lat === 'number' && Number.isFinite(gate.lat) ? gate.lat : null,
    lng: typeof gate.lng === 'number' && Number.isFinite(gate.lng) ? gate.lng : null,
    radiusMeters: Number.isFinite(radius)
      ? Math.min(MAX_RADIUS_METERS, Math.max(MIN_RADIUS_METERS, radius))
      : DEFAULT_RADIUS_METERS,
    cooldownMs: normalizeCooldownMs(gate.cooldownMs),
    bluetooth: normalizeBluetooth(gate.bluetooth),
    lastOpenedAt:
      typeof gate.lastOpenedAt === 'number' && Number.isFinite(gate.lastOpenedAt)
        ? gate.lastOpenedAt
        : null,
    lastResult: gate.lastResult != null ? String(gate.lastResult) : null,
  };
}
