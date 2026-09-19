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
import i18n from '../i18n';
import {
  displayGateName,
  loadGates,
  saveGates,
  type GateConfig,
} from '../data/gatesStore';
import {
  getSystem,
  listLinkedSystems,
  listSystems,
  loadCredentialsForGate,
  upsertSystem,
} from '../data/palgateSystems';
import { normalizeBluetooth } from '../data/gateBluetooth';
import { normalizeCooldownMs } from '../data/cooldownNormalize';
import { stripLeakedPalGateCatalog } from '../data/sharedCatalog';
import {
  bytesToInviteCode,
  clampInviteCooldownMs,
  clampInviteHoldMs,
  clampInviteRadiusMeters,
  INVITE_MAX_GATES,
  INVITE_MAX_PACKS,
  inviteGateList,
  isRealFirebaseAccount,
  isValidInviteCode,
  normalizeInviteCode,
  partitionInviteGates,
  sharedGateId,
  toShareGateMap,
  type InviteStatus,
  type SharedGatePayload,
} from './inviteLogic';
import type { PalGateCredentials } from '../palgate/types';
import {
  applyShareRevokeState,
  inviteMatchesUnlinkedSystem,
  palgateFingerprint,
  type RevokedShareHint,
} from './shareRevokeLogic';

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
  /** Set when the owner unlinks that PalGate. Invite-only revoke is false. */
  systemUnlinked?: boolean | null;
};

async function requireSharingUser(): Promise<{ uid: string }> {
  const user = auth.currentUser;
  if (!user) throw new Error(i18n.t('share.errSignIn'));
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
    throw new Error(i18n.t('share.errNeedAccount'));
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
    return i18n.t('auth.errPermission');
  }
  return error instanceof Error ? error.message : i18n.t('share.createFail');
}

function requireUid(): string {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error(i18n.t('share.errSignIn'));
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
    holdEnabled: Boolean(gate.holdEnabled),
    holdMs: clampInviteHoldMs(gate.holdMs),
    bluetooth: { required: false, devices: [] },
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
  if (gates.length === 0) throw new Error(i18n.t('share.errSelect'));
  if (gates.length > INVITE_MAX_GATES) {
    throw new Error(i18n.t('share.errMaxGates', { count: INVITE_MAX_GATES }));
  }

  const toEmailLower = options?.toEmail?.trim().toLowerCase() || null;
  if (toEmailLower && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmailLower)) {
    throw new Error(i18n.t('share.errEmail'));
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
        i18n.t('share.errNoCreds', { name: displayGateName(gate) }),
      );
    }
    const fp = `${creds.phoneNumber}:${creds.sessionToken.toLowerCase()}`;
    let credIndex = packs.findIndex(
      (p) => `${p.phoneNumber}:${p.sessionToken.toLowerCase()}` === fp,
    );
    if (credIndex < 0) {
      if (packs.length >= INVITE_MAX_PACKS) {
        throw new Error(i18n.t('share.errTooManySystems'));
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
      toShareGateMap({
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
    holdEnabled: Boolean(g.holdEnabled),
    holdMs: clampInviteHoldMs(g.holdMs),
  }));
  const fallback: SharedGatePayload = {
    deviceId: '',
    name: '',
    nameOverride: null,
    lat: null,
    lng: null,
    radiusMeters: 50,
    cooldownMs: 30_000,
    holdEnabled: false,
    holdMs: 0,
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
    systemUnlinked:
      data.systemUnlinked === true
        ? true
        : data.systemUnlinked === false
          ? false
          : null,
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

export async function acceptInvite(
  rawCode: string,
  options?: { deviceIds?: string[] },
): Promise<GateConfig | null> {
  const uid = requireUid();
  const invite = await getInviteByCode(rawCode);
  if (!invite) throw new Error(i18n.t('share.errNoInvite'));
  if (invite.fromUid === uid) {
    throw new Error(i18n.t('share.errOwnCode'));
  }
  if (invite.status === 'revoked') throw new Error(i18n.t('share.errRevoked'));
  if (invite.status === 'declined') throw new Error(i18n.t('share.errDeclined'));
  if (invite.status === 'accepted' && invite.acceptedByUid !== uid) {
    throw new Error(i18n.t('share.errUsed'));
  }
  if (invite.status === 'pending') {
    const expires = invite.expiresAt?.toMillis() ?? 0;
    if (expires && expires < Date.now()) {
      throw new Error(i18n.t('share.errExpired'));
    }
  }

  const invited = invite.gates.length ? invite.gates : [invite.gate];
  const stored = await loadGates();
  const { toAdd } = partitionInviteGates(invited, stored);
  const allow = options?.deviceIds?.length
    ? new Set(options.deviceIds.map((id) => String(id).trim()).filter(Boolean))
    : null;
  const adding = allow
    ? toAdd.filter((g) => allow.has(String(g.deviceId ?? '').trim()))
    : toAdd;

  const systemByIndex: string[] = [];
  if (adding.length > 0) {
    const packs = await readInvitePacks(invite.code);
    if (packs.length === 0 || !packs[0]?.sessionToken) {
      throw new Error(i18n.t('share.errCredsGone'));
    }
    for (let i = 0; i < packs.length; i++) {
      const pack = packs[i];
      const packGates = adding.filter((g) => (g.credIndex ?? 0) === i);
      if (packGates.length === 0) continue;
      const label =
        packGates[0]?.systemLabel ||
        invite.gate.systemLabel ||
        'Shared';
      const allowedDeviceIds = packGates
        .map((g) => String(g.deviceId ?? '').trim())
        .filter(Boolean);
      const system = await upsertSystem(
        {
          sessionToken: pack.sessionToken,
          phoneNumber: pack.phoneNumber,
          tokenType: pack.tokenType as 0 | 1 | 2,
        },
        { origin: 'shared', label, allowedDeviceIds },
      );
      systemByIndex[i] = system.id;
    }
  }

  let next = [...stored];
  let first: GateConfig | null = null;
  for (const payload of adding) {
    const credIndex = payload.credIndex ?? 0;
    const systemId = systemByIndex[credIndex] ?? systemByIndex[0];
    if (!systemId) continue;
    const id = sharedGateId(invite.code, payload.deviceId);
    const display =
      payload.nameOverride?.trim() || payload.name?.trim() || payload.deviceId;
    const gate: GateConfig = {
      id,
      deviceId: payload.deviceId,
      systemId,
      origin: 'shared',
      sharedInviteCode: invite.code,
      sharedFromName: invite.fromName || null,
      name: display,
      nameOverride: payload.nameOverride?.trim() || null,
      enabled: false,
      lat: payload.lat,
      lng: payload.lng,
      radiusMeters: payload.radiusMeters,
      cooldownMs: payload.cooldownMs,
      holdEnabled: Boolean(payload.holdEnabled),
      holdMs: payload.holdMs ?? 0,
      bluetooth: { required: false, devices: [] },
      lastOpenedAt: null,
      lastResult: null,
    };
    const idx = next.findIndex((g) => g.id === id);
    if (idx >= 0) next[idx] = { ...next[idx], ...gate, enabled: next[idx].enabled };
    else next.push(gate);
    if (!first) first = gate;
  }
  if (adding.length > 0) {
    const systems = await listSystems();
    await saveGates(stripLeakedPalGateCatalog(next, systems));
  }

  if (invite.status === 'pending') {
    await updateDoc(doc(db, 'invites', invite.code), {
      status: 'accepted',
      acceptedByUid: uid,
      acceptedAt: serverTimestamp(),
    });
  }

  return first;
}

export async function declineInvite(rawCode: string): Promise<void> {
  const uid = requireUid();
  const invite = await getInviteByCode(rawCode);
  if (!invite) throw new Error(i18n.t('share.errNoInvite'));
  if (invite.fromUid === uid) throw new Error(i18n.t('share.errDeclineOwn'));
  if (invite.status !== 'pending') return;
  await updateDoc(doc(db, 'invites', invite.code), {
    status: 'declined',
    acceptedByUid: uid,
    acceptedAt: serverTimestamp(),
  });
}

export async function revokeInvite(
  code: string,
  options?: { systemUnlinked?: boolean },
): Promise<void> {
  const uid = requireUid();
  const invite = await getInviteByCode(code);
  if (!invite) return;
  if (invite.fromUid !== uid) throw new Error(i18n.t('share.errRevokeOther'));
  if (invite.status === 'declined') return;
  await updateDoc(doc(db, 'invites', code), {
    status: 'revoked',
    systemUnlinked: Boolean(options?.systemUnlinked),
  });
  await deleteDoc(doc(db, 'inviteCreds', code)).catch(() => undefined);
}

export async function syncRevokedShares(): Promise<string[]> {
  const uid = auth.currentUser?.uid;
  if (!uid) return [];
  const accepted = await listAcceptedInvites();
  const hintFromInvite = (
    inv: InviteDoc & { code: string },
  ): { code: string; deviceIds: string[] } => {
    const payloads = inv.gates.length ? inv.gates : [inv.gate];
    return {
      code: inv.code,
      deviceIds: payloads
        .map((p) => String(p.deviceId ?? '').trim())
        .filter((id) => Boolean(id) && !id.startsWith('share:')),
    };
  };
  const revoked: RevokedShareHint[] = accepted
    .filter((i) => i.status === 'revoked')
    .map((inv) => ({
      ...hintFromInvite(inv),
      systemUnlinked: inv.systemUnlinked,
    }));
  const live = accepted
    .filter((i) => i.status === 'accepted')
    .map(hintFromInvite);
  const systems = (await listSystems())
    .filter((s) => s.origin === 'shared')
    .map((s) => ({ id: s.id, allowedDeviceIds: s.allowedDeviceIds }));
  const before = await loadGates();
  const { gates: next, changedIds } = applyShareRevokeState(
    before,
    revoked,
    live,
    systems,
  );
  if (changedIds.length > 0) {
    await saveGates(next);
    void import('../data/accountSync')
      .then((m) => m.scheduleCloudPush())
      .catch(() => undefined);
  }
  return changedIds;
}

/**
 * Owner unlinked a PalGate system: revoke every invite that used those
 * credentials or those device ids. Recipients disable copies on sync.
 */
export async function revokeOutgoingInvitesForSystem(input: {
  sessionToken: string;
  phoneNumber: number;
  deviceIds: string[];
}): Promise<number> {
  const uid = auth.currentUser?.uid;
  if (!uid) return 0;
  const fingerprint = palgateFingerprint(input.phoneNumber, input.sessionToken);
  const outgoing = await listOutgoingInvites();
  let n = 0;
  for (const inv of outgoing) {
    if (inv.fromUid !== uid) continue;
    if (inv.status === 'revoked' || inv.status === 'declined') continue;
    const payloads = inv.gates.length ? inv.gates : [inv.gate];
    const inviteDeviceIds = payloads
      .map((p) => String(p.deviceId ?? '').trim())
      .filter(Boolean);
    let packFingerprints: string[] = [];
    try {
      const packs = await readInvitePacks(inv.code);
      packFingerprints = packs.map((p) =>
        palgateFingerprint(p.phoneNumber, p.sessionToken),
      );
    } catch {
      packFingerprints = [];
    }
    if (
      !inviteMatchesUnlinkedSystem({
        inviteDeviceIds,
        packFingerprints,
        systemFingerprint: fingerprint,
        systemDeviceIds: input.deviceIds,
      })
    ) {
      continue;
    }
    await revokeInvite(inv.code, { systemUnlinked: true });
    n += 1;
  }
  return n;
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
        holdEnabled: Boolean(payload.holdEnabled),
        holdMs: payload.holdMs ?? 0,
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
