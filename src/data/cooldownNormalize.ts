/** Default open-retry cooldown: 30 seconds. */
export const DEFAULT_COOLDOWN_SECONDS = 30;
export const DEFAULT_COOLDOWN_MS = DEFAULT_COOLDOWN_SECONDS * 1000;

/**
 * Normalize cooldown to milliseconds.
 * - Values >= 1000 are already ms (e.g. 10000 = 10s, 300000 = 5 min).
 * - Values in (0, 1000) are treated as **seconds** (matches Gate Editor label),
 *   not minutes — so a stored `10` becomes 10s, not 10 minutes.
 */
export function normalizeCooldownMs(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_COOLDOWN_MS;
  if (n === 0) return 0;
  if (n < 1000) return Math.round(n * 1000);
  return Math.round(n);
}
