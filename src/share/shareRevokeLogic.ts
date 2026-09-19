import type { GateConfig } from '../data/gatesStore';
import { palGateDeviceKey } from './inviteLogic';

export type RevokedShareHint = {
  code: string;
  deviceIds: string[];
  /**
   * true: owner unlinked that PalGate.
   * false: owner revoked an invite code only.
   * null/undefined: legacy docs from before this flag.
   */
  systemUnlinked?: boolean | null;
};

export type LiveShareHint = {
  code: string;
  deviceIds: string[];
};

export type SharedSystemHint = {
  id: string;
  allowedDeviceIds?: string[] | null;
};

export function isShareDisabled(gate: {
  shareDisabled?: boolean | null;
}): boolean {
  return Boolean(gate.shareDisabled);
}

export function palgateFingerprint(
  phoneNumber: number,
  sessionToken: string,
): string {
  return `${Number(phoneNumber)}:${String(sessionToken).trim().toLowerCase()}`;
}

export function inviteMatchesUnlinkedSystem(input: {
  inviteDeviceIds: string[];
  packFingerprints: string[];
  systemFingerprint: string;
  systemDeviceIds: string[];
}): boolean {
  const systemFp = String(input.systemFingerprint ?? '').trim();
  if (
    systemFp &&
    input.packFingerprints.some((fp) => fp === systemFp)
  ) {
    return true;
  }
  const want = new Set(
    input.systemDeviceIds.map((id) => palGateId(id)).filter(Boolean),
  );
  if (want.size === 0) return false;
  return input.inviteDeviceIds.some((id) => want.has(palGateId(id)));
}

function palGateId(raw: string | null | undefined): string {
  const id = String(raw ?? '').trim();
  if (!id || id.startsWith('share:')) return '';
  return id;
}

function hintDeviceIds(hint: { deviceIds?: string[] }): Set<string> {
  return new Set(
    (hint.deviceIds ?? []).map((id) => palGateId(id)).filter(Boolean),
  );
}

function inviteOverlapsGate(
  gate: Pick<GateConfig, 'sharedInviteCode' | 'deviceId' | 'id'>,
  hint: { code: string; deviceIds: string[] },
): boolean {
  const code = String(gate.sharedInviteCode ?? '').trim();
  if (code && code === String(hint.code ?? '').trim()) return true;
  const deviceId = palGateId(palGateDeviceKey(gate));
  return Boolean(deviceId && hintDeviceIds(hint).has(deviceId));
}

function groupKeyForGate(
  gate: GateConfig,
  systems: SharedSystemHint[],
): string {
  const sid = String(gate.systemId ?? '').trim();
  if (sid) return `sys:${sid}`;
  const deviceId = palGateId(palGateDeviceKey(gate));
  const allowHits = systems.filter((sys) => {
    const id = String(sys.id ?? '').trim();
    if (!id) return false;
    return (sys.allowedDeviceIds ?? []).some(
      (item) => palGateId(item) === deviceId && Boolean(deviceId),
    );
  });
  if (allowHits.length === 1) return `sys:${allowHits[0].id}`;
  if (systems.length === 1 && systems[0]?.id) return `sys:${systems[0].id}`;
  return `loose:${deviceId || gate.id}`;
}

function findRoot(parent: Map<string, string>, key: string): string {
  let cur = parent.get(key) ?? key;
  while (cur !== (parent.get(cur) ?? cur)) {
    cur = parent.get(cur) ?? cur;
  }
  parent.set(key, cur);
  return cur;
}

/**
 * Recipient copies disable only when the owner PalGate system is gone.
 * A leftover invite of 2-of-4 must not mark those two revoked while the
 * same system is still shared.
 */
export function applyShareRevokeState(
  gates: GateConfig[],
  revoked: RevokedShareHint[],
  live: LiveShareHint[] = [],
  systems: SharedSystemHint[] = [],
): { gates: GateConfig[]; changedIds: string[] } {
  const sharedSystems = systems.filter((s) => String(s.id ?? '').trim());
  const groups = new Map<string, number[]>();
  gates.forEach((gate, index) => {
    if (gate.origin !== 'shared') return;
    const key = groupKeyForGate(gate, sharedSystems);
    const list = groups.get(key) ?? [];
    list.push(index);
    groups.set(key, list);
  });

  const keys = [...groups.keys()];
  const parent = new Map(keys.map((k) => [k, k]));
  const union = (a: string, b: string) => {
    const pa = findRoot(parent, a);
    const pb = findRoot(parent, b);
    if (pa !== pb) parent.set(pa, pb);
  };
  const groupOverlaps = (
    key: string,
    hint: { code: string; deviceIds: string[] },
  ): boolean =>
    (groups.get(key) ?? []).some((i) => inviteOverlapsGate(gates[i], hint));

  for (const hint of [...revoked, ...live]) {
    const hit = keys.filter((k) => groupOverlaps(k, hint));
    for (let i = 1; i < hit.length; i++) union(hit[0], hit[i]);
  }

  const merged = new Map<string, number[]>();
  for (const key of keys) {
    const root = findRoot(parent, key);
    merged.set(root, [...(merged.get(root) ?? []), ...(groups.get(key) ?? [])]);
  }

  const disableIds = new Set<string>();
  const clearIds = new Set<string>();
  for (const indexes of merged.values()) {
    const group = indexes.map((i) => gates[i]);
    const relatedLive = live.filter((h) =>
      group.some((g) => inviteOverlapsGate(g, h)),
    );
    const relatedRevoked = revoked.filter((h) =>
      group.some((g) => inviteOverlapsGate(g, h)),
    );
    const unlinked = relatedRevoked.some((h) => h.systemUnlinked === true);
    const legacyGone =
      relatedRevoked.some((h) => h.systemUnlinked == null) &&
      relatedLive.length === 0;
    const systemGone =
      relatedLive.length === 0 && (unlinked || legacyGone);
    for (const gate of group) {
      if (systemGone) disableIds.add(gate.id);
      else if (gate.shareDisabled) clearIds.add(gate.id);
    }
  }

  const changedIds: string[] = [];
  const next = gates.map((gate) => {
    if (gate.origin !== 'shared') return gate;
    if (disableIds.has(gate.id)) {
      if (gate.shareDisabled && !gate.enabled) return gate;
      changedIds.push(gate.id);
      return { ...gate, shareDisabled: true, enabled: false };
    }
    if (clearIds.has(gate.id)) {
      changedIds.push(gate.id);
      return { ...gate, shareDisabled: false };
    }
    return gate;
  });
  return { gates: next, changedIds };
}

/**
 * Owner unlinked PalGate: keep shared-in rows, turn off Open / Auto.
 * Does not delete. Prefer applyShareRevokeState when live invites are known.
 */
export function disableSharedGatesFromRevoke(
  gates: GateConfig[],
  revoked: RevokedShareHint[],
): { gates: GateConfig[]; changedIds: string[] } {
  return applyShareRevokeState(gates, revoked, [], []);
}
