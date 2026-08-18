import type { DeviceSummary, GateConfig, GateOrigin } from './gatesStore';

export const SHARED_ALLOWLIST_MAX = 24;

export type SharedCatalogOrigin = 'linked' | 'shared';

export type SharedCatalogSystem = {
  id: string;
  origin: SharedCatalogOrigin;
  /** Invite-copied PalGate account: only these device ids may appear from list/sync. */
  allowedDeviceIds?: string[] | null;
};

export function isSharedOrigin(origin: string | null | undefined): boolean {
  return origin === 'shared';
}

export function isSharedOnlyVault(
  gates: Array<{ origin?: string | null }>,
): boolean {
  return gates.length > 0 && gates.every((g) => g.origin === 'shared');
}

export function normalizeAllowedDeviceIds(
  raw: unknown,
): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const id = String(item ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id.slice(0, 120));
    if (out.length >= SHARED_ALLOWLIST_MAX) break;
  }
  return out;
}

export function mergeAllowedDeviceIds(
  current: unknown,
  incoming: unknown,
): string[] {
  return normalizeAllowedDeviceIds([
    ...normalizeAllowedDeviceIds(current),
    ...normalizeAllowedDeviceIds(incoming),
  ]);
}

/** Owner-linked PalGate may list the full catalog. Shared-in must not. */
export function shouldRefreshPalGateCatalog(system: {
  origin?: string | null;
}): boolean {
  return system.origin !== 'shared';
}

function allowlistHas(
  allow: Set<string>,
  deviceId: string,
): boolean {
  if (allow.has(deviceId)) return true;
  const base = deviceId.split(':')[0] ?? deviceId;
  return allow.has(base);
}

/**
 * Filter a PalGate devices payload to the share allowlist.
 * Linked systems (no allowlist) pass through unchanged.
 */
export function filterDevicesForSystem(
  devices: DeviceSummary[],
  system: {
    origin?: string | null;
    allowedDeviceIds?: string[] | null;
  },
): DeviceSummary[] {
  if (shouldRefreshPalGateCatalog(system) && !system.allowedDeviceIds?.length) {
    return devices;
  }
  const allow = new Set(normalizeAllowedDeviceIds(system.allowedDeviceIds));
  if (allow.size === 0) return [];
  return devices.filter((d) => allowlistHas(allow, d.deviceId));
}

/**
 * After a share accept, leftover owner rows (local/native/PalGate catalog)
 * must not sit next to the N shared-in gates unless this uid also QR-linked.
 */
export function stripLeakedPalGateCatalog(
  gates: GateConfig[],
  systems: SharedCatalogSystem[],
): GateConfig[] {
  const linkedSystemIds = new Set(
    systems.filter((s) => s.origin === 'linked').map((s) => s.id),
  );
  if (linkedSystemIds.size === 0) {
    return gates.filter((g) => g.origin === 'shared');
  }
  return gates.filter((g) => {
    if (g.origin === 'shared') return true;
    if (g.systemId && linkedSystemIds.has(g.systemId)) return true;
    if (!g.systemId) return true;
    return false;
  });
}

export function allowedDeviceIdsFromGates(
  gates: Array<{ deviceId?: string; origin?: GateOrigin | string | null }>,
): string[] {
  return normalizeAllowedDeviceIds(
    gates.filter((g) => g.origin === 'shared').map((g) => g.deviceId),
  );
}
