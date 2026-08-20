import AsyncStorage from '@react-native-async-storage/async-storage';
import { appendEvent } from './eventLog';
import {
  applyBurstOpen,
  BURST_WINDOW_MS,
  formatSafetyLockMessage,
  normalizeGateState,
  type GateSafetyState,
} from './safetyBurst';
import {
  burstConfigFromSettings,
  loadSafetyLockSettings,
} from './safetyLockSettings';
import { hydrateUserScope, scopedAsyncKey } from './userScope';

export {
  applyBurstOpen,
  BURST_COUNT,
  BURST_WINDOW_MS,
  formatSafetyLockMessage,
  GATE_LOCK_MS,
  GLOBAL_LOCK_MS,
  type BurstApplyResult,
  type GateSafetyState,
} from './safetyBurst';

function safetyKey(): string {
  return scopedAsyncKey('openSafetyLock');
}

type OpenSafetyState = {
  /** Per-gate lock + burst state keyed by stable GateConfig.id. */
  byGateId: Record<string, GateSafetyState>;
};

export type OpenAllowed =
  | { ok: true }
  | { ok: false; remainingMs: number; message: string };

export type GateLockStatus = {
  gateId: string;
  locked: boolean;
  remainingMs: number;
  message: string | null;
};

let writeChain: Promise<void> = Promise.resolve();

function enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function defaultGateState(): GateSafetyState {
  return { lockUntil: null, openTimestamps: [] };
}

function defaultState(): OpenSafetyState {
  return { byGateId: {} };
}

/**
 * Accept current `{ byGateId }` shape, or drop legacy global
 * `{ lockUntil, openTimestamps }` (locks expire; burst is per-gate now).
 */
function normalizeState(raw: unknown): OpenSafetyState {
  if (!raw || typeof raw !== 'object') return defaultState();
  const obj = raw as { byGateId?: unknown };
  if (obj.byGateId && typeof obj.byGateId === 'object') {
    const byGateId: Record<string, GateSafetyState> = {};
    for (const [gateId, gateRaw] of Object.entries(
      obj.byGateId as Record<string, unknown>,
    )) {
      if (!gateId) continue;
      byGateId[gateId] = normalizeGateState(gateRaw);
    }
    return { byGateId };
  }
  return defaultState();
}

async function loadState(): Promise<OpenSafetyState> {
  await hydrateUserScope();
  const raw = await AsyncStorage.getItem(safetyKey());
  if (!raw) return defaultState();
  try {
    return normalizeState(JSON.parse(raw));
  } catch {
    return defaultState();
  }
}

async function nativeLockUntilByGateId(): Promise<Record<string, number>> {
  try {
    const { getNativeSafetyLocks } = await import('../platform/keepAliveAlarm');
    return await getNativeSafetyLocks();
  } catch {
    return {};
  }
}

/** Native auto-opens own the burst/lock; copy active native lockUntil into JS. */
async function mergeNativeLocks(state: OpenSafetyState): Promise<OpenSafetyState> {
  const native = await nativeLockUntilByGateId();
  const now = Date.now();
  let changed = false;
  for (const [gateId, lockUntil] of Object.entries(native)) {
    if (!gateId || !(lockUntil > now)) continue;
    const cur = state.byGateId[gateId] ?? defaultGateState();
    if ((cur.lockUntil ?? 0) < lockUntil) {
      state.byGateId[gateId] = { ...cur, lockUntil };
      changed = true;
    }
  }
  if (changed) await saveState(state);
  return state;
}

async function loadStateMerged(): Promise<OpenSafetyState> {
  return mergeNativeLocks(await loadState());
}

async function saveState(state: OpenSafetyState): Promise<void> {
  await hydrateUserScope();
  await AsyncStorage.setItem(safetyKey(), JSON.stringify(state));
}

function remainingForGate(gate: GateSafetyState, now: number): number {
  const lockUntil = gate.lockUntil ?? 0;
  return lockUntil > now ? lockUntil - now : 0;
}

function statusForGate(
  gateId: string,
  gate: GateSafetyState | undefined,
  now: number,
  gateLabel?: string,
): GateLockStatus {
  const remainingMs = remainingForGate(gate ?? defaultGateState(), now);
  if (remainingMs > 0) {
    return {
      gateId,
      locked: true,
      remainingMs,
      message: formatSafetyLockMessage(remainingMs, gateLabel),
    };
  }
  return { gateId, locked: false, remainingMs: 0, message: null };
}

/** Lock status for a single gate (stable GateConfig.id). */
export async function getLockStatus(
  gateId: string,
  gateLabel?: string,
): Promise<GateLockStatus> {
  const state = await loadStateMerged();
  return statusForGate(gateId, state.byGateId[gateId], Date.now(), gateLabel);
}

/**
 * All currently locked gates (for list banner). Optional labels map
 * gateId → display name.
 */
export async function getActiveLocks(
  labelsByGateId?: Record<string, string>,
): Promise<GateLockStatus[]> {
  const state = await loadStateMerged();
  const now = Date.now();
  const locked: GateLockStatus[] = [];
  for (const [gateId, gate] of Object.entries(state.byGateId)) {
    const status = statusForGate(
      gateId,
      gate,
      now,
      labelsByGateId?.[gateId],
    );
    if (status.locked) locked.push(status);
  }
  locked.sort((a, b) => b.remainingMs - a.remainingMs);
  return locked;
}

/** Banner text listing locked gates, or null if none. */
export async function getActiveLocksBanner(
  labelsByGateId?: Record<string, string>,
): Promise<string | null> {
  const locks = await getActiveLocks(labelsByGateId);
  if (locks.length === 0) return null;
  if (locks.length === 1) {
    return locks[0].message;
  }
  return locks
    .map((l) => {
      const mins = Math.max(1, Math.ceil(l.remainingMs / 60_000));
      const label = labelsByGateId?.[l.gateId]?.trim() || l.gateId;
      return `${label} (${mins}m)`;
    })
    .join(' · ')
    .replace(/^/, 'Safety lock: ');
}

/**
 * Check whether a geofence auto-open is allowed for this gate.
 * Manual opens (list Open / editor Test Open) must not call this — they stay allowed.
 * Does not mutate state. Call before openGate; log blocked opens via logBlockedOpen.
 */
export async function assertCanOpen(
  gateId: string,
  gateLabel?: string,
): Promise<OpenAllowed> {
  const status = await getLockStatus(gateId, gateLabel);
  if (!status.locked) return { ok: true };
  return {
    ok: false,
    remainingMs: status.remainingMs,
    message: status.message ?? formatSafetyLockMessage(status.remainingMs, gateLabel),
  };
}

/** Log that an open was blocked by this gate's safety lock. */
export async function logBlockedOpen(
  gateId: string,
  gateLabel?: string,
): Promise<string> {
  const status = await getLockStatus(gateId, gateLabel);
  const settings = await loadSafetyLockSettings();
  const message =
    status.message ??
    formatSafetyLockMessage(
      status.remainingMs || burstConfigFromSettings(settings).lockMs,
      gateLabel,
    );
  await appendEvent({
    kind: 'safety_lock',
    gateId,
    message: `Open blocked: ${message}`,
  });
  return message;
}

/**
 * Clear all per-gate safety locks (and burst counters). For testing after
 * remote false-open lockouts — manual Open always worked; this restores auto-open.
 */
export async function clearAllSafetyLocks(): Promise<number> {
  return enqueueWrite(async () => {
    const state = await loadStateMerged();
    const now = Date.now();
    let cleared = 0;
    for (const gate of Object.values(state.byGateId)) {
      if ((gate.lockUntil ?? 0) > now) cleared += 1;
    }
    try {
      const { clearNativeSafetyLocks } = await import('../platform/keepAliveAlarm');
      await clearNativeSafetyLocks();
    } catch {
      // ignore
    }
    await saveState(defaultState());
    await appendEvent({
      kind: 'info',
      message:
        cleared > 0
          ? `Safety locks cleared (${cleared} active)`
          : 'Safety locks cleared (none were active)',
    });
    return cleared;
  });
}

/**
 * Record a successful geofence auto-open toward this gate's burst counter.
 * Manual opens must not call this. If BURST_COUNT auto-opens for the same
 * gate fall within BURST_WINDOW_MS, engages GATE_LOCK_MS for that gate only.
 */
export async function recordSuccessfulOpen(
  gateId: string,
  gateLabel?: string,
): Promise<{
  lockEngaged: boolean;
  remainingMs: number;
}> {
  return enqueueWrite(async () => {
    const now = Date.now();
    const state = await loadState();
    const settings = await loadSafetyLockSettings();
    const burst = burstConfigFromSettings(settings);
    const applied = applyBurstOpen(state.byGateId[gateId], now, burst);
    state.byGateId[gateId] = applied.next;
    await saveState(state);

    if (applied.lockEngaged) {
      const lockMins = Math.round(burst.lockMs / 60_000);
      const windowMins = Math.round(BURST_WINDOW_MS / 60_000);
      const who = gateLabel?.trim() ? `${gateLabel.trim()}: ` : '';
      await appendEvent({
        kind: 'safety_lock',
        gateId,
        message: `${who}Safety lock engaged for ${lockMins}m (${burst.burstCount} auto-opens in ${windowMins}m)`,
      });
    }

    return {
      lockEngaged: applied.lockEngaged,
      remainingMs: applied.remainingMs,
    };
  });
}
