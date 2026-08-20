/** Successful auto-opens that trigger the per-gate lock (default). */
export const MIN_BURST_COUNT = 3;
export const MAX_BURST_COUNT = 20;
export const DEFAULT_BURST_COUNT = 3;
/** @deprecated Prefer DEFAULT_BURST_COUNT — kept as the runtime default. */
export const BURST_COUNT = DEFAULT_BURST_COUNT;

/** Rolling window for counting successful auto-opens. */
export const BURST_WINDOW_MS = 2 * 60 * 1000;

/** How long a gate lock lasts once engaged (minutes). */
export const MIN_GATE_LOCK_MINUTES = 5;
export const MAX_GATE_LOCK_MINUTES = 120;
export const DEFAULT_GATE_LOCK_MINUTES = 15;
export const GATE_LOCK_MS = DEFAULT_GATE_LOCK_MINUTES * 60 * 1000;

/** @deprecated Use GATE_LOCK_MS */
export const GLOBAL_LOCK_MS = GATE_LOCK_MS;

export type BurstConfig = {
  burstCount: number;
  lockMs: number;
};

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

export function clampBurstCount(raw: unknown): number {
  const n =
    typeof raw === 'number' && Number.isFinite(raw)
      ? Math.trunc(raw)
      : Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n)) return DEFAULT_BURST_COUNT;
  return Math.min(MAX_BURST_COUNT, Math.max(MIN_BURST_COUNT, n));
}

export function clampLockMinutes(raw: unknown): number {
  const n =
    typeof raw === 'number' && Number.isFinite(raw)
      ? Math.round(raw)
      : Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n)) return DEFAULT_GATE_LOCK_MINUTES;
  return Math.min(MAX_GATE_LOCK_MINUTES, Math.max(MIN_GATE_LOCK_MINUTES, n));
}

export function lockMsFromMinutes(minutes: unknown): number {
  return clampLockMinutes(minutes) * 60 * 1000;
}

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

function resolveConfig(config?: BurstConfig): BurstConfig {
  return {
    burstCount: clampBurstCount(config?.burstCount ?? DEFAULT_BURST_COUNT),
    lockMs: lockMsFromMinutes(
      config?.lockMs != null && Number.isFinite(config.lockMs)
        ? config.lockMs / 60_000
        : DEFAULT_GATE_LOCK_MINUTES,
    ),
  };
}

/**
 * Pure burst-lock step: record one successful auto-open at `now`.
 * Does not touch storage. Pass `config` so JS and native share the same numbers.
 */
export function applyBurstOpen(
  prev: GateSafetyState | undefined,
  now: number,
  config?: BurstConfig,
): BurstApplyResult {
  const { burstCount, lockMs } = resolveConfig(config);
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

  if (openTimestamps.length >= burstCount) {
    return {
      next: { lockUntil: now + lockMs, openTimestamps: [] },
      lockEngaged: true,
      remainingMs: lockMs,
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
