import type { GateConfig } from '../data/gatesStore';

export type RevokedShareHint = {
  code: string;
  deviceIds: string[];
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
    input.systemDeviceIds.map((id) => String(id ?? '').trim()).filter(Boolean),
  );
  if (want.size === 0) return false;
  return input.inviteDeviceIds.some((id) => want.has(String(id ?? '').trim()));
}

/**
 * Owner unlinked PalGate: keep shared-in rows, turn off Open / Auto.
 * Does not delete.
 */
export function disableSharedGatesFromRevoke(
  gates: GateConfig[],
  revoked: RevokedShareHint[],
): { gates: GateConfig[]; changedIds: string[] } {
  if (revoked.length === 0) return { gates, changedIds: [] };
  const codes = new Set(
    revoked.map((row) => String(row.code ?? '').trim()).filter(Boolean),
  );
  const deviceIds = new Set(
    revoked.flatMap((row) =>
      (row.deviceIds ?? []).map((id) => String(id ?? '').trim()).filter(Boolean),
    ),
  );
  const changedIds: string[] = [];
  const next = gates.map((gate) => {
    if (gate.origin !== 'shared') return gate;
    const code = String(gate.sharedInviteCode ?? '').trim();
    const deviceId = String(gate.deviceId ?? '').trim();
    const hit =
      (code && codes.has(code)) || (deviceId && deviceIds.has(deviceId));
    if (!hit) return gate;
    if (gate.shareDisabled && !gate.enabled) return gate;
    changedIds.push(gate.id);
    return { ...gate, shareDisabled: true, enabled: false };
  });
  return { gates: next, changedIds };
}
