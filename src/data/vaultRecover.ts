import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  copyUidVault,
  maybeAdoptUnscopedVault,
} from './accountVault';
import { loadGates, saveGates, type GateConfig } from './gatesStore';
import { listSystems, restoreSystems, type PalGateSystemMeta } from './palgateSystems';
import { getActiveUid, UNSCOPED_ASYNC, asyncKeyForUid } from './userScope';
import { readNativeRegionsJson } from '../platform/keepAliveAlarm';
import {
  NATIVE_UID,
  UNBOUNDED_UID,
  gatesFromNativeRegions,
  mergeGateLists,
  pickRecoverableVault,
  shouldRecoverOwnerVault,
  type RecoveredGate,
  type VaultSnapshot,
} from './vaultRecoverLogic';

const GATES_KEY_RE = /^gateauto\.u\.([A-Za-z0-9_-]+)\.gates$/;
const SYSTEMS_KEY_RE = /^gateauto\.u\.([A-Za-z0-9_-]+)\.systems\.v1$/;

function parseGates(raw: string | null): RecoveredGate[] {
  if (!raw || raw === '[]') return [];
  try {
    const parsed = JSON.parse(raw) as RecoveredGate[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseSystems(raw: string | null): PalGateSystemMeta[] {
  if (!raw || raw === '[]') return [];
  try {
    const parsed = JSON.parse(raw) as PalGateSystemMeta[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function snapshotForUid(uid: string): Promise<VaultSnapshot> {
  const [gatesRaw, sysRaw] = await Promise.all([
    AsyncStorage.getItem(asyncKeyForUid(uid, 'gates')),
    AsyncStorage.getItem(asyncKeyForUid(uid, 'systems.v1')),
  ]);
  return {
    uid,
    gates: parseGates(gatesRaw),
    systemsMeta: parseSystems(sysRaw),
  };
}

async function scanLocalVaults(): Promise<VaultSnapshot[]> {
  const keys = await AsyncStorage.getAllKeys();
  const uids = new Set<string>();
  for (const key of keys) {
    const gateMatch = GATES_KEY_RE.exec(key);
    if (gateMatch) uids.add(gateMatch[1]);
    const sysMatch = SYSTEMS_KEY_RE.exec(key);
    if (sysMatch) uids.add(sysMatch[1]);
  }
  const out: VaultSnapshot[] = [];
  for (const uid of uids) {
    out.push(await snapshotForUid(uid));
  }
  const unscopedGates = parseGates(await AsyncStorage.getItem(UNSCOPED_ASYNC.gates));
  const unscopedSys = parseSystems(await AsyncStorage.getItem(UNSCOPED_ASYNC.systems));
  if (unscopedGates.length > 0 || unscopedSys.length > 0) {
    out.push({
      uid: UNBOUNDED_UID,
      gates: unscopedGates,
      systemsMeta: unscopedSys,
    });
  }
  try {
    const nativeRaw = await readNativeRegionsJson();
    if (nativeRaw && nativeRaw !== '[]') {
      const nativeGates = gatesFromNativeRegions(JSON.parse(nativeRaw));
      if (nativeGates.length > 0) {
        out.push({ uid: NATIVE_UID, gates: nativeGates, systemsMeta: [] });
      }
    }
  } catch {
    // Native module missing on tests / iOS.
  }
  return out;
}

async function shareCounts(): Promise<{
  incomingPendingCount: number;
  outgoingCount: number;
}> {
  try {
    const { listIncomingPendingInvites, listOutgoingInvites } = await import(
      '../share/invites'
    );
    return {
      incomingPendingCount: (await listIncomingPendingInvites()).length,
      outgoingCount: (await listOutgoingInvites()).length,
    };
  } catch {
    return { incomingPendingCount: 0, outgoingCount: 0 };
  }
}

async function applyNativeAndInviteFill(current: GateConfig[]): Promise<GateConfig[]> {
  let next: RecoveredGate[] = current;
  try {
    const nativeRaw = await readNativeRegionsJson();
    if (nativeRaw && nativeRaw !== '[]') {
      next = mergeGateLists(next, gatesFromNativeRegions(JSON.parse(nativeRaw)));
    }
  } catch {
    // ignore
  }
  try {
    const { ownerInviteRestorePayload } = await import('../share/invites');
    const snapshot = await ownerInviteRestorePayload();
    if (snapshot?.gates.length) {
      next = mergeGateLists(next, snapshot.gates);
    }
  } catch {
    // ignore
  }
  return next as GateConfig[];
}

/**
 * If this Google/email owner has an empty uid store, copy leftover device data
 * into it. Invitees (pending incoming, password-only) are not given the owner's gates.
 */
export async function recoverOwnerVaultOnDevice(input: {
  isRealAccount: boolean;
  providers?: string[];
}): Promise<{ recovered: boolean; gateCount: number }> {
  const uid = getActiveUid();
  if (!uid) return { recovered: false, gateCount: 0 };

  const { incomingPendingCount, outgoingCount } = await shareCounts();
  if (
    !shouldRecoverOwnerVault({
      isRealAccount: input.isRealAccount,
      providers: input.providers,
      incomingPendingCount,
      outgoingCount,
    })
  ) {
    return { recovered: false, gateCount: (await loadGates()).length };
  }

  await maybeAdoptUnscopedVault(input);

  const currentGates = await loadGates();
  const currentSystems = await listSystems();
  const candidates = await scanLocalVaults();
  const picked = pickRecoverableVault({
    currentUid: uid,
    currentGates,
    currentSystemCount: currentSystems.length,
    candidates,
    isRealAccount: input.isRealAccount,
    providers: input.providers,
    incomingPendingCount,
    outgoingCount,
  });

  if (picked && picked.uid !== NATIVE_UID && picked.uid !== UNBOUNDED_UID) {
    await copyUidVault(picked.uid, uid);
  } else if (picked?.uid === UNBOUNDED_UID) {
    await maybeAdoptUnscopedVault(input);
  }

  let gates = await loadGates();
  const filled = await applyNativeAndInviteFill(gates);
  if (JSON.stringify(filled) !== JSON.stringify(gates)) {
    await saveGates(filled);
    gates = filled;
  }

  if ((await listSystems()).length === 0) {
    try {
      const { ownerInviteRestorePayload } = await import('../share/invites');
      const snapshot = await ownerInviteRestorePayload();
      if (snapshot?.credentials) {
        const { upsertSystem } = await import('./palgateSystems');
        const system = await upsertSystem(snapshot.credentials, {
          origin: 'linked',
          label: snapshot.systemLabel,
        });
        if (!gates.some((g) => g.systemId)) {
          gates = gates.map((g) =>
            g.origin === 'shared' ? g : { ...g, systemId: g.systemId || system.id },
          );
          await saveGates(gates);
        }
      }
    } catch {
      // Invite creds are best-effort; user may need to re-scan PalGate QR.
    }
  }

  const finalGates = await loadGates();
  const finalSystems = await listSystems();
  return {
    recovered: finalGates.length > 0 || finalSystems.length > 0,
    gateCount: finalGates.length,
  };
}

export async function applyCloudVaultToLocal(input: {
  gates: GateConfig[];
  systems: import('./palgateSystems').PalGateSystem[];
}): Promise<void> {
  if (input.systems.length > 0) {
    await restoreSystems(input.systems);
  }
  await saveGates(input.gates);
}
