import * as Crypto from 'expo-crypto';
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { auth, db } from '../firebase/app';
import {
  displayGateName,
  loadGates,
  removeGate,
  saveGates,
  type GateConfig,
} from '../data/gatesStore';
import {
  getSystem,
  listLinkedSystems,
  loadCredentialsForGate,
  upsertSystem,
} from '../data/palgateSystems';
import { normalizeBluetooth } from '../data/gateBluetooth';
import { normalizeCooldownMs } from '../data/cooldownNormalize';
import {
  bytesToInviteCode,
  isValidInviteCode,
  normalizeInviteCode,
  sharedGateId,
  type InviteStatus,
  type SharedGatePayload,
} from './inviteLogic';

export type InviteDoc = {
  fromUid: string;
  fromName: string;
  toEmailLower: string | null;
  status: InviteStatus;
  createdAt: Timestamp | null;
  expiresAt: Timestamp | null;
  acceptedByUid: string | null;
  acceptedAt: Timestamp | null;
  gate: SharedGatePayload;
};

function requireUid(): string {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Sign in first.');
  return uid;
}

function displayNameOfUser(): string {
  const u = auth.currentUser;
  return u?.displayName?.trim() || u?.email?.trim() || 'GateAuto user';
}

async function newInviteCode(): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const bytes = await Crypto.getRandomBytesAsync(16);
    const code = bytesToInviteCode(bytes);
    const snap = await getDoc(doc(db, 'invites', code));
    if (!snap.exists()) return code;
  }
  throw new Error('Could not allocate an invite code. Try again.');
}

function gatePayload(gate: GateConfig, systemLabel: string): SharedGatePayload {
  return {
    deviceId: gate.deviceId,
    name: gate.name,
    nameOverride: gate.nameOverride,
    lat: gate.lat,
    lng: gate.lng,
    radiusMeters: gate.radiusMeters,
    cooldownMs: gate.cooldownMs,
    bluetooth: {
      required: Boolean(gate.bluetooth?.required),
      devices: (gate.bluetooth?.devices ?? []).map((d) => ({
        ...(d.name ? { name: d.name } : {}),
        ...(d.address ? { address: d.address } : {}),
      })),
    },
    systemLabel,
  };
}

export async function createGateInvite(
  gate: GateConfig,
  options?: { toEmail?: string },
): Promise<{ code: string }> {
  const uid = requireUid();
  const creds = await loadCredentialsForGate(gate);
  if (!creds) throw new Error('This gate has no PalGate credentials to share.');

  const system = gate.systemId ? await getSystem(gate.systemId) : null;
  const linked = await listLinkedSystems();
  const label =
    system?.label ||
    linked[0]?.label ||
    displayGateName(gate);

  const toEmailLower = options?.toEmail?.trim().toLowerCase() || null;
  if (toEmailLower && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmailLower)) {
    throw new Error('That email does not look valid.');
  }

  const code = await newInviteCode();
  const expires = Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const batch = writeBatch(db);
  batch.set(doc(db, 'invites', code), {
    fromUid: uid,
    fromName: displayNameOfUser().slice(0, 80),
    toEmailLower,
    status: 'pending',
    createdAt: serverTimestamp(),
    expiresAt: expires,
    acceptedByUid: null,
    acceptedAt: null,
    gate: gatePayload(gate, label.slice(0, 80)),
  });
  batch.set(doc(db, 'inviteCreds', code), {
    sessionToken: creds.sessionToken,
    phoneNumber: creds.phoneNumber,
    tokenType: creds.tokenType,
  });
  await batch.commit();
  return { code };
}

function parseInvite(id: string, data: Record<string, unknown>): InviteDoc & { code: string } {
  const gateRaw = (data.gate ?? {}) as Record<string, unknown>;
  const btRaw = (gateRaw.bluetooth ?? {}) as {
    required?: unknown;
    devices?: unknown;
  };
  return {
    code: id,
    fromUid: String(data.fromUid ?? ''),
    fromName: String(data.fromName ?? ''),
    toEmailLower:
      typeof data.toEmailLower === 'string' ? data.toEmailLower : null,
    status: (data.status as InviteStatus) || 'pending',
    createdAt: (data.createdAt as Timestamp) ?? null,
    expiresAt: (data.expiresAt as Timestamp) ?? null,
    acceptedByUid:
      typeof data.acceptedByUid === 'string' ? data.acceptedByUid : null,
    acceptedAt: (data.acceptedAt as Timestamp) ?? null,
    gate: {
      deviceId: String(gateRaw.deviceId ?? ''),
      name: String(gateRaw.name ?? ''),
      nameOverride:
        typeof gateRaw.nameOverride === 'string' ? gateRaw.nameOverride : null,
      lat: typeof gateRaw.lat === 'number' ? gateRaw.lat : null,
      lng: typeof gateRaw.lng === 'number' ? gateRaw.lng : null,
      radiusMeters: Number(gateRaw.radiusMeters) || 50,
      cooldownMs: normalizeCooldownMs(gateRaw.cooldownMs),
      bluetooth: normalizeBluetooth({
        required: btRaw.required,
        devices: btRaw.devices,
      }),
      systemLabel: String(gateRaw.systemLabel ?? 'Shared'),
    },
  };
}

export async function getInviteByCode(rawCode: string): Promise<
  (InviteDoc & { code: string }) | null
> {
  const code = normalizeInviteCode(rawCode);
  if (!isValidInviteCode(code)) return null;
  const snap = await getDoc(doc(db, 'invites', code));
  if (!snap.exists()) return null;
  return parseInvite(snap.id, snap.data() as Record<string, unknown>);
}

export async function listOutgoingInvites(): Promise<
  Array<InviteDoc & { code: string }>
> {
  const uid = requireUid();
  const q = query(collection(db, 'invites'), where('fromUid', '==', uid));
  const snap = await getDocs(q);
  return snap.docs.map((d) =>
    parseInvite(d.id, d.data() as Record<string, unknown>),
  );
}

export async function listIncomingPendingInvites(): Promise<
  Array<InviteDoc & { code: string }>
> {
  const email = auth.currentUser?.email?.trim().toLowerCase();
  if (!email) return [];
  const q = query(
    collection(db, 'invites'),
    where('toEmailLower', '==', email),
    where('status', '==', 'pending'),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) =>
    parseInvite(d.id, d.data() as Record<string, unknown>),
  );
}

export async function listAcceptedInvites(): Promise<
  Array<InviteDoc & { code: string }>
> {
  const uid = requireUid();
  const q = query(
    collection(db, 'invites'),
    where('acceptedByUid', '==', uid),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) =>
    parseInvite(d.id, d.data() as Record<string, unknown>),
  );
}

async function readInviteCreds(code: string): Promise<{
  sessionToken: string;
  phoneNumber: number;
  tokenType: number;
} | null> {
  const snap = await getDoc(doc(db, 'inviteCreds', code));
  if (!snap.exists()) return null;
  const d = snap.data();
  return {
    sessionToken: String(d.sessionToken ?? ''),
    phoneNumber: Number(d.phoneNumber),
    tokenType: Number(d.tokenType),
  };
}

export async function acceptInvite(rawCode: string): Promise<GateConfig> {
  const uid = requireUid();
  const invite = await getInviteByCode(rawCode);
  if (!invite) throw new Error('No invite for that code.');
  if (invite.fromUid === uid) {
    throw new Error('That code is one you created. Send it to someone else.');
  }
  if (invite.status === 'revoked') throw new Error('That invite was revoked.');
  if (invite.status === 'declined') throw new Error('That invite was declined.');
  if (invite.status === 'accepted' && invite.acceptedByUid !== uid) {
    throw new Error('That invite was already used.');
  }
  if (invite.status === 'pending') {
    const expires = invite.expiresAt?.toMillis() ?? 0;
    if (expires && expires < Date.now()) {
      throw new Error('That invite expired. Ask for a new code.');
    }
  }

  const creds = await readInviteCreds(invite.code);
  if (!creds || !creds.sessionToken) {
    throw new Error('Invite credentials are no longer available.');
  }

  const system = await upsertSystem(
    {
      sessionToken: creds.sessionToken,
      phoneNumber: creds.phoneNumber,
      tokenType: creds.tokenType as 0 | 1 | 2,
    },
    { origin: 'shared', label: invite.gate.systemLabel || 'Shared' },
  );

  const id = sharedGateId(invite.code, invite.gate.deviceId);
  const gate: GateConfig = {
    id,
    deviceId: invite.gate.deviceId,
    systemId: system.id,
    origin: 'shared',
    sharedInviteCode: invite.code,
    sharedFromName: invite.fromName || null,
    name: invite.gate.name || invite.gate.deviceId,
    nameOverride: invite.gate.nameOverride,
    enabled: false,
    lat: invite.gate.lat,
    lng: invite.gate.lng,
    radiusMeters: invite.gate.radiusMeters,
    cooldownMs: invite.gate.cooldownMs,
    bluetooth: invite.gate.bluetooth,
    lastOpenedAt: null,
    lastResult: null,
  };

  const gates = await loadGates();
  const idx = gates.findIndex((g) => g.id === id);
  if (idx >= 0) gates[idx] = { ...gates[idx], ...gate, enabled: gates[idx].enabled };
  else gates.push(gate);
  await saveGates(gates);

  if (invite.status === 'pending') {
    await updateDoc(doc(db, 'invites', invite.code), {
      status: 'accepted',
      acceptedByUid: uid,
      acceptedAt: serverTimestamp(),
    });
  }

  return gate;
}

export async function declineInvite(rawCode: string): Promise<void> {
  const uid = requireUid();
  const invite = await getInviteByCode(rawCode);
  if (!invite) throw new Error('No invite for that code.');
  if (invite.fromUid === uid) throw new Error('You cannot decline your own invite.');
  if (invite.status !== 'pending') return;
  await updateDoc(doc(db, 'invites', invite.code), {
    status: 'declined',
    acceptedByUid: uid,
    acceptedAt: serverTimestamp(),
  });
}

export async function revokeInvite(code: string): Promise<void> {
  const uid = requireUid();
  const invite = await getInviteByCode(code);
  if (!invite) return;
  if (invite.fromUid !== uid) throw new Error('Only the sender can revoke this.');
  if (invite.status === 'declined') return;
  await updateDoc(doc(db, 'invites', code), { status: 'revoked' });
  await deleteDoc(doc(db, 'inviteCreds', code)).catch(() => undefined);
}

export async function syncRevokedShares(): Promise<string[]> {
  const uid = auth.currentUser?.uid;
  if (!uid) return [];
  const accepted = await listAcceptedInvites();
  const revoked = accepted.filter((i) => i.status === 'revoked');
  const removed: string[] = [];
  for (const inv of revoked) {
    const id = sharedGateId(inv.code, inv.gate.deviceId);
    const before = await loadGates();
    if (!before.some((g) => g.id === id)) continue;
    await removeGate(id);
    removed.push(id);
  }
  return removed;
}
