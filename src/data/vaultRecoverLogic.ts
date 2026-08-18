import { shouldAdoptUnscopedVault } from './userScope';
import { isSharedOnlyVault } from './sharedCatalog';

export const UNBOUNDED_UID = '_unscoped';
export const NATIVE_UID = '_native';

export type RecoveredGate = {
  id: string;
  deviceId: string;
  systemId: string | null;
  origin: 'linked' | 'shared';
  sharedInviteCode: string | null;
  sharedFromName: string | null;
  name: string;
  nameOverride: string | null;
  enabled: boolean;
  lat: number | null;
  lng: number | null;
  radiusMeters: number;
  cooldownMs: number;
  bluetooth: {
    required: boolean;
    devices: Array<{ name?: string; address?: string }>;
  };
  lastOpenedAt: number | null;
  lastResult: string | null;
};

export type VaultSystemsMeta = {
  id: string;
  label: string;
  origin: 'linked' | 'shared';
  source?: 'linked' | 'shared';
  allowedDeviceIds?: string[] | null;
  createdAt: number;
};

export type VaultSnapshot = {
  uid: string;
  gates: RecoveredGate[];
  systemsMeta: VaultSystemsMeta[];
};

export function linkedGateCount(gates: RecoveredGate[]): number {
  return gates.filter((g) => g.origin !== 'shared').length;
}

export function vaultScore(snap: VaultSnapshot): number {
  return linkedGateCount(snap.gates) * 10 + snap.systemsMeta.length;
}

export function shouldRecoverOwnerVault(input: {
  isRealAccount: boolean;
  providers?: string[];
  incomingPendingCount: number;
  outgoingCount: number;
}): boolean {
  return shouldAdoptUnscopedVault(input);
}

/**
 * Pick leftover local data to copy into the signed-in owner account.
 * Returns null for invitees, guests, and when the current uid already has a vault.
 */
export function pickRecoverableVault(input: {
  currentUid: string;
  currentGates: RecoveredGate[];
  currentSystemCount: number;
  candidates: VaultSnapshot[];
  isRealAccount: boolean;
  providers?: string[];
  incomingPendingCount: number;
  outgoingCount: number;
}): VaultSnapshot | null {
  if (
    !shouldRecoverOwnerVault({
      isRealAccount: input.isRealAccount,
      providers: input.providers,
      incomingPendingCount: input.incomingPendingCount,
      outgoingCount: input.outgoingCount,
    })
  ) {
    return null;
  }
  if (linkedGateCount(input.currentGates) > 0 && input.currentSystemCount > 0) {
    return null;
  }
  if (isSharedOnlyVault(input.currentGates)) {
    return null;
  }
  const ranked = input.candidates
    .filter((c) => c.uid !== input.currentUid && vaultScore(c) > 0)
    .sort((a, b) => {
      const diff = vaultScore(b) - vaultScore(a);
      if (diff !== 0) return diff;
      return b.gates.length - a.gates.length;
    });
  if (ranked.length === 0) return null;
  const best = ranked[0];
  if (input.currentGates.length > 0 && linkedGateCount(best.gates) === 0) {
    return best.systemsMeta.length > input.currentSystemCount ? best : null;
  }
  if (input.currentGates.length > 0 && input.currentSystemCount > 0) return null;
  return best;
}

type NativeRegionLike = {
  id?: string;
  deviceId?: string;
  lat?: number;
  lng?: number;
  radius?: number;
  name?: string;
  displayName?: string;
  cooldownMs?: number;
  btRequired?: boolean;
  btAddresses?: string[];
  btNames?: string[];
  enabled?: boolean;
};

export function gatesFromNativeRegions(raw: unknown): RecoveredGate[] {
  if (!Array.isArray(raw)) return [];
  const out: RecoveredGate[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as NativeRegionLike;
    const deviceId = String(r.deviceId ?? r.id ?? '').trim();
    if (!deviceId) continue;
    const id = String(r.id ?? deviceId).trim() || deviceId;
    const addresses = Array.isArray(r.btAddresses)
      ? r.btAddresses.map((a) => String(a ?? '').trim()).filter(Boolean)
      : [];
    const names = Array.isArray(r.btNames)
      ? r.btNames.map((n) => String(n ?? '').trim()).filter(Boolean)
      : [];
    const devices: RecoveredGate['bluetooth']['devices'] = [];
    const n = Math.max(addresses.length, names.length);
    for (let i = 0; i < n; i++) {
      const name = names[i];
      const address = addresses[i];
      if (!name && !address) continue;
      devices.push({
        ...(name ? { name } : {}),
        ...(address ? { address } : {}),
      });
    }
    const lat =
      typeof r.lat === 'number' && Number.isFinite(r.lat) ? r.lat : null;
    const lng =
      typeof r.lng === 'number' && Number.isFinite(r.lng) ? r.lng : null;
    const radius = Number(r.radius);
    const cooldown = Number(r.cooldownMs);
    const label = String(r.displayName || r.name || deviceId).trim() || deviceId;
    out.push({
      id,
      deviceId,
      systemId: null,
      origin: id.startsWith('share:') ? 'shared' : 'linked',
      sharedInviteCode: null,
      sharedFromName: null,
      name: String(r.name || label),
      nameOverride:
        r.displayName && r.displayName !== r.name ? String(r.displayName) : null,
      enabled: r.enabled !== false,
      lat,
      lng,
      radiusMeters: Number.isFinite(radius) ? radius : 50,
      cooldownMs: Number.isFinite(cooldown) && cooldown >= 0 ? cooldown : 30_000,
      bluetooth: {
        required: Boolean(r.btRequired),
        devices,
      },
      lastOpenedAt: null,
      lastResult: null,
    });
  }
  return out;
}

export function mergeGateLists(
  primary: RecoveredGate[],
  fill: RecoveredGate[],
  options?: { appendUnmatched?: boolean },
): RecoveredGate[] {
  if (primary.length === 0) return fill;
  if (fill.length === 0) return primary;
  const appendUnmatched = options?.appendUnmatched ?? !isSharedOnlyVault(primary);
  const merged = primary.map((g) => ({ ...g }));
  const extra: RecoveredGate[] = [];
  for (const gate of fill) {
    const idx = merged.findIndex(
      (g) => g.id === gate.id || g.deviceId === gate.deviceId,
    );
    if (idx < 0) {
      if (appendUnmatched) extra.push(gate);
      continue;
    }
    const existing = merged[idx];
    merged[idx] = {
      ...existing,
      lat: existing.lat ?? gate.lat,
      lng: existing.lng ?? gate.lng,
      nameOverride: existing.nameOverride ?? gate.nameOverride,
      systemId: existing.systemId ?? gate.systemId,
      bluetooth:
        existing.bluetooth.devices.length > 0
          ? existing.bluetooth
          : gate.bluetooth,
      enabled: existing.enabled || gate.enabled,
    };
  }
  return [...merged, ...extra];
}

export function initialHubRoute(input: {
  gateCount: number;
  systemCount: number;
}): 'GatesList' | 'GateSystems' {
  return input.gateCount > 0 || input.systemCount > 0
    ? 'GatesList'
    : 'GateSystems';
}
