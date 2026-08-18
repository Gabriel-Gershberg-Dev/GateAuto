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
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { auth, db } from '../firebase/app';
import { FIRESTORE_DATABASE_ID } from '../firebase/config';
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
  clampInviteCooldownMs,
  clampInviteRadiusMeters,
  INVITE_MAX_GATES,
  INVITE_MAX_PACKS,
  inviteGateList,
  isRealFirebaseAccount,
  isValidInviteCode,
  normalizeInviteCode,
  sharedGateId,
  toInviteGateMap,
  type InviteStatus,
  type SharedGatePayload,
} from './inviteLogic';
import type { PalGateCredentials } from '../palgate/types';

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
  gates: SharedGatePayload[];
};

async function requireSharingUser(): Promise<{ uid: string }> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in first.');
  await user.reload();
  const token = await user.getIdTokenResult(true);
  const latest = auth.currentUser ?? user;
  const providers = latest.providerData.map((p) => p.providerId);
  const signInProvider = String(
    token.signInProvider ||
      (token.claims.firebase as { sign_in_provider?: string } | undefined)
        ?.sign_in_provider ||
      '',
  );
  console.warn(
    `[GateAuto invite] auth db=${FIRESTORE_DATABASE_ID} uid=${latest.uid} isAnonymous=${latest.isAnonymous} providers=${providers.join(',') || '-'} signInProvider=${signInProvider || '-'}`,
  );
  if (
    !isRealFirebaseAccount({
      isAnonymous: latest.isAnonymous,
      providers,
    })
  ) {
    throw new Error('Sign in with Google or email to share a gate.');
  }
  return { uid: latest.uid };
}

function firestoreCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: string }).code)
    : '';
}

function inviteWriteMessage(error: unknown, step: string): string {
  const code = firestoreCode(error);
  console.warn(
    `[GateAuto invite] ${step} PERMISSION path=invites|inviteCreds db=${FIRESTORE_DATABASE_ID} code=${code || 'none'} ${error instanceof Error ? error.message : ''}`,
  );
  if (code === 'permission-denied') {
    return 'Cloud permissions blocked this invite. Sign in with Google or email and try again.';
  }
  return error instanceof Error ? error.message : 'Could not create invite.';
}

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
  const bytes = await Crypto.getRandomBytesAsync(16);
  return bytesToInviteCode(bytes);
}

function gatePayload(gate: GateConfig, systemLabel: string): SharedGatePayload {
  return {
    deviceId: gate.deviceId,
    name: gate.name,
    nameOverride: gate.nameOverride,
    lat: gate.lat,
    lng: gate.lng,
    radiusMeters: clampInviteRadiusMeters(gate.radiusMeters),
    cooldownMs: clampInviteCooldownMs(gate.cooldownMs),
    bluetooth: {
      required: Boolean(gate.bluetooth?.required),
      devices: (gate.bluetooth?.devices ?? []).map((d) => ({
        ...(d.name ? { name: d.name } : {}),
        ...(d.address ? { address: d.address } : {}),
      })),
    },
    systemLabel,
    credIndex: 0,
  };
}

export async function createGateInvite(
  gate: GateConfig,
  options?: { toEmail?: string },
): Promise<{ code: string }> {
  return createGateInvites([gate], options);
}

export async function createGateInvites(
  gates: GateConfig[],
  options?: { toEmail?: string },
): Promise<{ code: string }> {
  requireUid();
  if (gates.length === 0) throw new Error('Select at least one gate.');
  if (gates.length > INVITE_MAX_GATES) {
    throw new Error(`Share up to ${INVITE_MAX_GATES} gates in one code.`);
  }

  const toEmailLower = options?.toEmail?.trim().toLowerCase() || null;
  if (toEmailLower && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmailLower)) {
    throw new Error('That email does not look valid.');
  }

  const linked = await listLinkedSystems();
  const packs: Array<{
    sessionToken: string;
    phoneNumber: number;
    tokenType: number;
  }> = [];
  const payloads: SharedGatePayload[] = [];

  for (const gate of gates) {
    const creds = await loadCredentialsForGate(gate);
    if (!creds) {
      throw new Error(
        `${displayGateName(gate)} has no PalGate credentials to share.`,
      );
    }
    const fp = `${creds.phoneNumber}:${creds.sessionToken.toLowerCase()}`;
    let credIndex = packs.findIndex(
      (p) => `${p.phoneNumber}:${p.sessionToken.toLowerCase()}` === fp,
    );
    if (credIndex < 0) {
      if (packs.length >= INVITE_MAX_PACKS) {
        throw new Error('Too many PalGate systems in this share.');
      }
      packs.push({
        sessionToken: String(creds.sessionToken).trim().toLowerCase().slice(0, 512),
        phoneNumber: Number(creds.phoneNumber),
        tokenType: Number(creds.tokenType),
      });
      credIndex = packs.length - 1;
    }
    const system = gate.systemId ? await getSystem(gate.systemId) : null;
    const label =
      system?.label ||
      linked[0]?.label ||
      displayGateName(gate);
    payloads.push(
      toInviteGateMap({
        ...gatePayload(gate, label.slice(0, 80)),
        credIndex,
      }),
    );
  }

  const { uid } = await requireSharingUser();
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
    gate: payloads[0],
    gates: payloads,
  });
  batch.set(doc(db, 'inviteCreds', code), { packs });
  console.warn(
    `[GateAuto invite] create db=${FIRESTORE_DATABASE_ID} path=invites/${code} gates=${payloads.length} packs=${packs.length} ids=${payloads.map((p) => p.deviceId).join(',')} radius=${payloads.map((p) => p.radiusMeters).join(',')} cooldown=${payloads.map((p) => p.cooldownMs).join(',')} packPhoneFinite=${packs.every((p) => Number.isFinite(p.phoneNumber))} packTokenLen=${packs.map((p) => String(p.sessionToken).length).join(',')}`,
  );
  try {
    await batch.commit();
  } catch (error) {
    throw new Error(inviteWriteMessage(error, `create invites/${code}`));
  }
  return { code };
}

function parseInvite(id: string, data: Record<string, unknown>): InviteDoc & { code: string } {
  const gates = inviteGateList(data).map((g) => ({
    ...g,
    bluetooth: normalizeBluetooth(g.bluetooth),
    cooldownMs: normalizeCooldownMs(g.cooldownMs),
  }));
  const fallback: SharedGatePayload = {
    deviceId: '',
    name: '',
    nameOverride: null,
    lat: null,
    lng: null,
    radiusMeters: 50,
    cooldownMs: 30_000,
    bluetooth: { required: false, devices: [] },
    systemLabel: 'Shared',
    credIndex: 0,
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
    gate: gates[0] ?? fallback,
    gates,
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

async function readInvitePacks(code: string): Promise<
  Array<{
    sessionToken: string;
    phoneNumber: number;
    tokenType: number;
  }>
> {
  const snap = await getDoc(doc(db, 'inviteCreds', code));
  if (!snap.exists()) return [];
  const d = snap.data();
  if (Array.isArray(d.packs) && d.packs.length > 0) {
    return d.packs.map((p: Record<string, unknown>) => ({
      sessionToken: String(p.sessionToken ?? ''),
      phoneNumber: Number(p.phoneNumber),
      tokenType: Number(p.tokenType),
    }));
  }
  if (d.sessionToken) {
    return [
      {
        sessionToken: String(d.sessionToken ?? ''),
        phoneNumber: Number(d.phoneNumber),
        tokenType: Number(d.tokenType),
      },
    ];
  }
  return [];
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

  const packs = await readInvitePacks(invite.code);
  if (packs.length === 0 || !packs[0]?.sessionToken) {
    throw new Error('Invite credentials are no longer available.');
  }

  const systemByIndex: string[] = [];
  for (let i = 0; i < packs.length; i++) {
    const pack = packs[i];
    const label =
      invite.gates.find((g) => g.credIndex === i)?.systemLabel ||
      invite.gate.systemLabel ||
      'Shared';
    const system = await upsertSystem(
      {
        sessionToken: pack.sessionToken,
        phoneNumber: pack.phoneNumber,
        tokenType: pack.tokenType as 0 | 1 | 2,
      },
      { origin: 'shared', label },
    );
    systemByIndex[i] = system.id;
  }

  const stored = await loadGates();
  let next = [...stored];
  let first: GateConfig | null = null;
  for (const payload of invite.gates.length ? invite.gates : [invite.gate]) {
    const credIndex = payload.credIndex ?? 0;
    const systemId = systemByIndex[credIndex] ?? systemByIndex[0];
    const id = sharedGateId(invite.code, payload.deviceId);
    const gate: GateConfig = {
      id,
      deviceId: payload.deviceId,
      systemId,
      origin: 'shared',
      sharedInviteCode: invite.code,
      sharedFromName: invite.fromName || null,
      name: payload.name || payload.deviceId,
      nameOverride: payload.nameOverride,
      enabled: false,
      lat: payload.lat,
      lng: payload.lng,
      radiusMeters: payload.radiusMeters,
      cooldownMs: payload.cooldownMs,
      bluetooth: payload.bluetooth,
      lastOpenedAt: null,
      lastResult: null,
    };
    const idx = next.findIndex((g) => g.id === id);
    if (idx >= 0) next[idx] = { ...next[idx], ...gate, enabled: next[idx].enabled };
    else next.push(gate);
    if (!first) first = gate;
  }
  await saveGates(next);

  if (invite.status === 'pending') {
    await updateDoc(doc(db, 'invites', invite.code), {
      status: 'accepted',
      acceptedByUid: uid,
      acceptedAt: serverTimestamp(),
    });
  }

  return first!;
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
    const payloads = inv.gates.length ? inv.gates : [inv.gate];
    for (const payload of payloads) {
      const id = sharedGateId(inv.code, payload.deviceId);
      const before = await loadGates();
      if (!before.some((g) => g.id === id)) continue;
      await removeGate(id);
      removed.push(id);
    }
  }
  return removed;
}

/**
 * Owner-only: rebuild gates + PalGate token from invites this uid created.
 * Used when the device uid store is empty but share docs still exist.
 * Does not log session tokens.
 */
export async function ownerInviteRestorePayload(): Promise<{
  gates: GateConfig[];
  credentials: PalGateCredentials | null;
  systemLabel: string;
} | null> {
  const uid = auth.currentUser?.uid;
  if (!uid) return null;
  const outgoing = await listOutgoingInvites();
  const mine = outgoing.filter((inv) => inv.fromUid === uid);
  if (mine.length === 0) return null;

  const byDevice = new Map<string, GateConfig>();
  let credentials: PalGateCredentials | null = null;
  let systemLabel = 'Your PalGate';

  for (const inv of mine) {
    const payloads = inv.gates.length ? inv.gates : [inv.gate];
    if (!credentials) {
      const packs = await readInvitePacks(inv.code);
      const pack = packs[0];
      if (pack?.sessionToken && Number.isFinite(pack.phoneNumber) && pack.phoneNumber > 0) {
        credentials = {
          sessionToken: pack.sessionToken,
          phoneNumber: pack.phoneNumber,
          tokenType: pack.tokenType as 0 | 1 | 2,
        };
        systemLabel = payloads[0]?.systemLabel || systemLabel;
      }
    }
    for (const payload of payloads) {
      const deviceId = String(payload.deviceId ?? '').trim();
      if (!deviceId || byDevice.has(deviceId)) continue;
      byDevice.set(deviceId, {
        id: deviceId,
        deviceId,
        systemId: null,
        origin: 'linked',
        sharedInviteCode: null,
        sharedFromName: null,
        name: payload.name || deviceId,
        nameOverride: payload.nameOverride,
        enabled: true,
        lat: payload.lat,
        lng: payload.lng,
        radiusMeters: payload.radiusMeters,
        cooldownMs: payload.cooldownMs,
        bluetooth: payload.bluetooth,
        lastOpenedAt: null,
        lastResult: null,
      });
    }
  }

  const gates = [...byDevice.values()];
  if (gates.length === 0 && !credentials) return null;
  return { gates, credentials, systemLabel: systemLabel.slice(0, 80) };
}
