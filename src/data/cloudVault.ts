import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  writeBatch,
  type DocumentData,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { auth, db } from '../firebase/app';
import { isRealFirebaseAccount } from '../share/inviteLogic';
import { displayGateName, type GateConfig } from './gatesStore';
import type { PalGateCredentials } from '../palgate/types';
import type { PalGateSystem, PalGateSystemMeta } from './palgateSystems';
import { normalizeAllowedDeviceIds } from './sharedCatalog';

export const CLOUD_MAX_GATES = 24;
export const CLOUD_MAX_SYSTEMS = 8;

function providersOf(user: User): string[] {
  return user.providerData.map((p) => p.providerId);
}

export function isCloudAccount(user: User | null | undefined): boolean {
  if (!user) return false;
  return isRealFirebaseAccount({
    isAnonymous: user.isAnonymous,
    providers: providersOf(user),
    email: user.email,
  });
}

export function currentCloudUid(): string | null {
  const user = auth.currentUser;
  if (!user || !isCloudAccount(user)) return null;
  return user.uid;
}

function clip(value: string, max: number): string {
  return value.slice(0, max);
}

function cloudDocId(id: string): string {
  const cleaned = String(id ?? '')
    .replace(/\//g, '_')
    .trim();
  return cleaned.slice(0, 700) || 'item';
}

function finiteOrNull(raw: unknown, min: number, max: number): number | null {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

function btFromCloud(raw: unknown): GateConfig['bluetooth'] {
  const bt = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const devicesRaw = Array.isArray(bt.devices) ? bt.devices : [];
  return {
    required: Boolean(bt.required),
    devices: devicesRaw.slice(0, 12).map((item) => {
      const d = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
      return {
        ...(typeof d.name === 'string' && d.name.trim()
          ? { name: clip(d.name.trim(), 80) }
          : {}),
        ...(typeof d.address === 'string' && d.address.trim()
          ? { address: clip(d.address.trim(), 64) }
          : {}),
      };
    }),
  };
}

export function gateToCloud(gate: GateConfig, sortIndex: number): Record<string, unknown> {
  const displayName = clip(displayGateName(gate) || gate.deviceId || 'Gate', 120);
  return {
    displayName: displayName || 'Gate',
    deviceId: clip(String(gate.deviceId || gate.id), 120),
    systemId: gate.systemId ? clip(gate.systemId, 80) : null,
    origin: gate.origin === 'shared' ? 'shared' : 'linked',
    sharedInviteCode: gate.sharedInviteCode
      ? clip(gate.sharedInviteCode, 16)
      : null,
    sharedFromName: gate.sharedFromName ? clip(gate.sharedFromName, 80) : null,
    name: clip(String(gate.name ?? ''), 120),
    nameOverride: gate.nameOverride ? clip(gate.nameOverride, 120) : null,
    enabled: Boolean(gate.enabled),
    lat: finiteOrNull(gate.lat, -90, 90),
    lng: finiteOrNull(gate.lng, -180, 180),
    radiusMeters: Math.min(150, Math.max(25, Math.round(Number(gate.radiusMeters) || 50))),
    cooldownMs: Math.min(3_600_000, Math.max(0, Math.round(Number(gate.cooldownMs) || 0))),
    bluetooth: {
      required: Boolean(gate.bluetooth?.required),
      devices: (gate.bluetooth?.devices ?? [])
        .slice(0, 12)
        .map((d) => ({
          ...(d.name ? { name: clip(String(d.name), 80) } : {}),
          ...(d.address ? { address: clip(String(d.address), 64) } : {}),
        }))
        .filter((d) => Boolean(d.name || d.address)),
    },
    lastOpenedAt:
      typeof gate.lastOpenedAt === 'number' && Number.isFinite(gate.lastOpenedAt)
        ? gate.lastOpenedAt
        : null,
    lastResult: gate.lastResult ? clip(String(gate.lastResult), 200) : null,
    sortIndex: Math.min(63, Math.max(0, Math.round(sortIndex))),
    updatedAt: serverTimestamp(),
  };
}

export function gateFromCloud(id: string, data: DocumentData): GateConfig {
  return {
    id,
    deviceId: String(data.deviceId ?? id),
    systemId:
      typeof data.systemId === 'string' && data.systemId.trim()
        ? data.systemId.trim()
        : null,
    origin: data.origin === 'shared' ? 'shared' : 'linked',
    sharedInviteCode:
      typeof data.sharedInviteCode === 'string' ? data.sharedInviteCode : null,
    sharedFromName:
      typeof data.sharedFromName === 'string' ? data.sharedFromName : null,
    name: String(data.name ?? data.displayName ?? data.deviceId ?? id),
    nameOverride:
      typeof data.nameOverride === 'string' && data.nameOverride.trim()
        ? data.nameOverride.trim()
        : null,
    enabled: Boolean(data.enabled),
    lat: finiteOrNull(data.lat, -90, 90),
    lng: finiteOrNull(data.lng, -180, 180),
    radiusMeters: Number(data.radiusMeters) || 50,
    cooldownMs: Number(data.cooldownMs) || 30_000,
    bluetooth: btFromCloud(data.bluetooth),
    lastOpenedAt:
      typeof data.lastOpenedAt === 'number' && Number.isFinite(data.lastOpenedAt)
        ? data.lastOpenedAt
        : null,
    lastResult: data.lastResult != null ? String(data.lastResult) : null,
  };
}

export type CloudVault = {
  gates: GateConfig[];
  systems: PalGateSystem[];
};

export async function pullCloudVault(uid: string): Promise<CloudVault> {
  const [gateSnap, sysSnap, secretSnap] = await Promise.all([
    getDocs(collection(db, 'users', uid, 'gates')),
    getDocs(collection(db, 'users', uid, 'systems')),
    getDocs(collection(db, 'users', uid, 'secrets')),
  ]);

  const gates = gateSnap.docs
    .map((d) => ({
      sort: Number(d.data().sortIndex) || 0,
      gate: gateFromCloud(d.id, d.data()),
    }))
    .sort((a, b) => a.sort - b.sort)
    .map((row) => row.gate);

  const secretById = new Map<string, PalGateCredentials>();
  for (const d of secretSnap.docs) {
    const data = d.data();
    const sessionToken = String(data.sessionToken ?? '').trim();
    const phoneNumber = Number(data.phoneNumber);
    const tokenType = Number(data.tokenType);
    if (!sessionToken || !Number.isFinite(phoneNumber) || phoneNumber <= 0) continue;
    if (tokenType !== 0 && tokenType !== 1 && tokenType !== 2) continue;
    secretById.set(d.id, { sessionToken, phoneNumber, tokenType });
  }

  const systems: PalGateSystem[] = [];
  for (const d of sysSnap.docs) {
    const data = d.data();
    const credentials = secretById.get(d.id);
    if (!credentials) continue;
    const origin = data.origin === 'shared' ? 'shared' : 'linked';
    const allowedDeviceIds =
      origin === 'shared' ? normalizeAllowedDeviceIds(data.allowedDeviceIds) : null;
    const meta: PalGateSystemMeta = {
      id: d.id,
      label: String(data.label ?? 'PalGate').slice(0, 80),
      origin,
      source: origin,
      allowedDeviceIds,
      createdAt: Date.now(),
    };
    systems.push({ ...meta, credentials });
  }

  return { gates, systems };
}

export async function pushCloudVault(
  uid: string,
  vault: { gates: GateConfig[]; systems: PalGateSystem[] },
): Promise<void> {
  const gates = vault.gates.slice(0, CLOUD_MAX_GATES);
  const systems = vault.systems.slice(0, CLOUD_MAX_SYSTEMS);
  const [gateSnap, sysSnap, secretSnap] = await Promise.all([
    getDocs(collection(db, 'users', uid, 'gates')),
    getDocs(collection(db, 'users', uid, 'systems')),
    getDocs(collection(db, 'users', uid, 'secrets')),
  ]);

  const batch = writeBatch(db);
  const keepGates = new Set(gates.map((g) => cloudDocId(g.id)));
  const keepSystems = new Set(systems.map((s) => cloudDocId(s.id)));

  gates.forEach((gate, index) => {
    const id = cloudDocId(gate.id);
    const ref = doc(db, 'users', uid, 'gates', id);
    const existing = gateSnap.docs.some((d) => d.id === id);
    const payload = gateToCloud(gate, index);
    if (!existing) payload.createdAt = serverTimestamp();
    batch.set(ref, payload, { merge: true });
  });
  for (const d of gateSnap.docs) {
    if (!keepGates.has(d.id)) batch.delete(d.ref);
  }

  for (const sys of systems) {
    const id = cloudDocId(sys.id);
    const ref = doc(db, 'users', uid, 'systems', id);
    const existing = sysSnap.docs.some((d) => d.id === id);
    const payload: Record<string, unknown> = {
      label: clip(sys.label || 'PalGate', 80) || 'PalGate',
      origin: sys.origin === 'shared' ? 'shared' : 'linked',
      allowedDeviceIds:
        sys.origin === 'shared'
          ? normalizeAllowedDeviceIds(sys.allowedDeviceIds)
          : null,
      updatedAt: serverTimestamp(),
    };
    if (!existing) payload.createdAt = serverTimestamp();
    batch.set(ref, payload, { merge: true });

    const secretRef = doc(db, 'users', uid, 'secrets', id);
    const secretExisting = secretSnap.docs.some((d) => d.id === id);
    const secretPayload: Record<string, unknown> = {
      sessionToken: clip(String(sys.credentials.sessionToken).trim(), 512),
      phoneNumber: Number(sys.credentials.phoneNumber),
      tokenType: Number(sys.credentials.tokenType),
      updatedAt: serverTimestamp(),
    };
    if (!secretExisting) secretPayload.createdAt = serverTimestamp();
    batch.set(secretRef, secretPayload, { merge: true });
  }
  for (const d of sysSnap.docs) {
    if (!keepSystems.has(d.id)) batch.delete(d.ref);
  }
  for (const d of secretSnap.docs) {
    if (!keepSystems.has(d.id)) batch.delete(d.ref);
  }

  await batch.commit();
}

export async function deleteCloudVaultDoc(
  uid: string,
  kind: 'gates' | 'systems' | 'secrets',
  id: string,
): Promise<void> {
  await deleteDoc(doc(db, 'users', uid, kind, cloudDocId(id)));
}
