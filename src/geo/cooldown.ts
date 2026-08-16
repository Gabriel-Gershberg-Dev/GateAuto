/**
 * Pure cooldown helper — used by auto-open and unit tests.
 * Returns remaining ms until the next auto-open is allowed (0 = allowed now).
 */
export function cooldownRemainingMs(
  lastOpenedAt: number | null | undefined,
  cooldownMs: number,
  now: number,
): number {
  if (!(cooldownMs > 0) || typeof lastOpenedAt !== 'number') return 0;
  const elapsed = now - lastOpenedAt;
  if (elapsed >= cooldownMs) return 0;
  return cooldownMs - elapsed;
}
