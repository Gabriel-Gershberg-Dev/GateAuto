/** Don't restore again immediately if the new session is rejected at once. */
export const GOOGLE_RESTORE_GAP_MS = 15_000;

/** A signed-out open may come back through the Google account already on the phone. */
export function canTryGoogleRestore(input: {
  explicitSignOut: boolean;
  lastAttemptAt: number;
  now: number;
}): boolean {
  if (input.explicitSignOut) return false;
  if (
    input.lastAttemptAt > 0 &&
    input.now - input.lastAttemptAt < GOOGLE_RESTORE_GAP_MS
  ) {
    return false;
  }
  return true;
}
