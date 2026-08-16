/** Successful auto-opens that trigger the per-gate lock. */
export const BURST_COUNT = 4;
/** Rolling window for counting successful auto-opens. */
export const BURST_WINDOW_MS = 2 * 60 * 1000;
/** How long a gate lock lasts once engaged. */
export const GATE_LOCK_MS = 40 * 60 * 1000;

/** @deprecated Use GATE_LOCK_MS */
export const GLOBAL_LOCK_MS = GATE_LOCK_MS;

export type GateSafetyState = {
  /** Epoch ms when this gate's lock ends; null/0 if unlocked. */
  lockUntil: number | null;
  /** Epoch ms of recent successful geofence auto-opens for this gate. */
  openTimestamps: number[];
};

export type BurstApplyResult = {
  next: GateSafetyState;
  lockEngaged: boolean;
  remainingMs: number;
};

function defaultGateState(): GateSafetyState {
  return { lockUntil: null, openTimestamps: [] };
}

export function normalizeGateState(raw: unknown): GateSafetyState {
  if (!raw || typeof raw !== 'object') return defaultGateState();
  const obj = raw as Partial<GateSafetyState>;
  const lockUntil =
    typeof obj.lockUntil === 'number' && obj.lockUntil > 0
      ? obj.lockUntil
      : null;
  const openTimestamps = Array.isArray(obj.openTimestamps)
    ? obj.openTimestamps.filter((ts): ts is number => typeof ts === 'number')
    : [];
  return { lockUntil, openTimestamps };
}

function pruneTimestamps(timestamps: number[], now: number): number[] {
  const cutoff = now - BURST_WINDOW_MS;
  return timestamps.filter((ts) => typeof ts === 'number' && ts > cutoff);
}

/**
 * Pure burst-lock step: record one successful auto-open at `now`.
 * Does not touch storage.
 */
export function applyBurstOpen(
  prev: GateSafetyState | undefined,
  now: number,
): BurstApplyResult {
  const normalized = normalizeGateState(prev);
  let lockUntil = normalized.lockUntil ?? 0;
  if (lockUntil <= now) lockUntil = 0;

  if (lockUntil > now) {
    return {
      next: {
        lockUntil,
        openTimestamps: pruneTimestamps(normalized.openTimestamps, now),
      },
      lockEngaged: false,
      remainingMs: lockUntil - now,
    };
  }

  const openTimestamps = pruneTimestamps(
    [...normalized.openTimestamps, now],
    now,
  );

  if (openTimestamps.length >= BURST_COUNT) {
    return {
      next: { lockUntil: now + GATE_LOCK_MS, openTimestamps: [] },
      lockEngaged: true,
      remainingMs: GATE_LOCK_MS,
    };
  }

  return {
    next: { lockUntil: null, openTimestamps },
    lockEngaged: false,
    remainingMs: 0,
  };
}

/** Human-readable banner / alert text with remaining minutes (ceil). */
export function formatSafetyLockMessage(
  remainingMs: number,
  gateLabel?: string,
): string {
  const mins = Math.max(1, Math.ceil(remainingMs / 60_000));
  const who = gateLabel?.trim() ? `${gateLabel.trim()}: ` : '';
  return `${who}Safety lock — wait ${mins}m (manual Open still works)`;
}
