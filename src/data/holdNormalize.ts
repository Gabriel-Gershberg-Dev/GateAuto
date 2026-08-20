/** Per-gate auto-open hold: silent PalGate pulses, then cooldown. */

export const MAX_HOLD_SECONDS = 90;
export const MAX_HOLD_MS = MAX_HOLD_SECONDS * 1000;
export const DEFAULT_HOLD_SECONDS = 30;
export const DEFAULT_HOLD_MS = DEFAULT_HOLD_SECONDS * 1000;
export const HOLD_PULSE_MIN_MS = 5_000;
export const HOLD_PULSE_MAX_MS = 8_000;
export const HOLD_DURATION_PRESETS = [10, 20, 30, 60, 90] as const;

/**
 * Normalize hold duration to milliseconds, capped at 90s.
 * Values in (0, 1000) are treated as seconds (matches the editor chips).
 * Off / invalid → 0.
 */
export function normalizeHoldMs(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const ms = n < 1000 ? Math.round(n * 1000) : Math.round(n);
  return Math.min(MAX_HOLD_MS, Math.max(0, ms));
}

/** When the switch is Off, duration is ignored. When On with empty duration, use 30s. */
export function effectiveHoldMs(holdEnabled: unknown, holdMs: unknown): number {
  if (!holdEnabled) return 0;
  const ms = normalizeHoldMs(holdMs);
  return ms > 0 ? ms : DEFAULT_HOLD_MS;
}

/** Pulse spacing: ~hold/4, never faster than 5s, never slower than 8s. */
export function holdPulseIntervalMs(holdMs: unknown): number {
  const ms = normalizeHoldMs(holdMs);
  if (ms <= 0) return 0;
  return Math.min(
    HOLD_PULSE_MAX_MS,
    Math.max(HOLD_PULSE_MIN_MS, Math.round(ms / 4)),
  );
}
