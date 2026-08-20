import {
  effectiveHoldMs,
  holdPulseIntervalMs,
  normalizeHoldMs,
} from '../data/holdNormalize';

export {
  DEFAULT_HOLD_MS,
  DEFAULT_HOLD_SECONDS,
  HOLD_DURATION_PRESETS,
  HOLD_PULSE_MAX_MS,
  HOLD_PULSE_MIN_MS,
  MAX_HOLD_MS,
  MAX_HOLD_SECONDS,
  effectiveHoldMs,
  holdPulseIntervalMs,
  normalizeHoldMs,
} from '../data/holdNormalize';

export type HoldAutoReason =
  | 'enter'
  | 'exit'
  | 'bt'
  | 'bt_connect'
  | 'poll'
  | 'eligible_now'
  | 'arm';

/** New ENTER / EXIT / listed-car BT may restart an in-progress hold. */
export function shouldRestartHoldFromAuto(reason: string | undefined): boolean {
  return (
    reason === 'enter' ||
    reason === 'exit' ||
    reason === 'bt' ||
    reason === 'bt_connect'
  );
}

/**
 * Recover / already-inside checks must not extend hold just because the
 * phone is still in the circle. Hold is a timer from the auto-open, not
 * “while inside.”
 */
export function isSittingAutoTrigger(reason: string | undefined): boolean {
  return (
    reason === 'poll' ||
    reason === 'eligible_now' ||
    reason === 'arm'
  );
}

export function isHoldActive(holdUntil: number | null | undefined, now: number): boolean {
  return typeof holdUntil === 'number' && holdUntil > now;
}

/**
 * Cooldown starts when hold ends (`holdUntil`), not at the first auto-open.
 * If hold is Off, this is just `lastOpenedAt`.
 */
export function cooldownStartAt(
  lastOpenedAt: number | null | undefined,
  holdUntil: number | null | undefined,
): number | null {
  const last =
    typeof lastOpenedAt === 'number' && Number.isFinite(lastOpenedAt) && lastOpenedAt > 0
      ? lastOpenedAt
      : 0;
  const hold =
    typeof holdUntil === 'number' && Number.isFinite(holdUntil) && holdUntil > 0
      ? holdUntil
      : 0;
  const start = Math.max(last, hold);
  return start > 0 ? start : null;
}

export function nextHoldPulseDelayMs(
  holdMs: unknown,
  remainingMs: number,
): number {
  const interval = holdPulseIntervalMs(holdMs);
  if (interval <= 0 || remainingMs < 5_000) return 0;
  return Math.min(interval, remainingMs);
}

export function gateHoldMs(gate: {
  holdEnabled?: boolean;
  holdMs?: number;
}): number {
  return effectiveHoldMs(gate.holdEnabled, gate.holdMs);
}
