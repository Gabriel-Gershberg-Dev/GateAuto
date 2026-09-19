/** Android Developer options uses 7 taps on the build number. */
export const TAPS_TO_BE_A_DEVELOPER = 7;

export type DevTapResult =
  | { kind: 'silent' }
  | { kind: 'countdown'; remaining: number }
  | { kind: 'askPassword' }
  | { kind: 'already' };

/**
 * Salted SHA-256 of the developer-unlock password (salt || password).
 * Plaintext is not stored in git, locales, Remote Config, or logs.
 */
export const DEV_UNLOCK_SALT = '49b463d8240ad76508160f8897f38d78';
export const DEV_UNLOCK_HASH =
  'aca9c0130049e92a70f51ec64bf38dc24976d349b6ff6a6b70ba39b14af9f888';

export function hashesEqual(left: string, right: string): boolean {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function saltedPasswordDigest(
  salt: string,
  password: string,
  sha256Hex: (value: string) => string,
): string {
  return sha256Hex(salt + password);
}

export function onDevVersionTap(opts: {
  unlocked: boolean;
  tapsBefore: number;
}): { taps: number; result: DevTapResult } {
  if (opts.unlocked) {
    return { taps: opts.tapsBefore, result: { kind: 'already' } };
  }
  if (opts.tapsBefore >= TAPS_TO_BE_A_DEVELOPER) {
    return { taps: opts.tapsBefore, result: { kind: 'askPassword' } };
  }
  const taps = opts.tapsBefore + 1;
  const remaining = TAPS_TO_BE_A_DEVELOPER - taps;
  if (remaining <= 0) {
    return { taps, result: { kind: 'askPassword' } };
  }
  // AOSP: toast once remaining is 1–4 (after the 3rd tap of 7).
  if (remaining < 5) {
    return { taps, result: { kind: 'countdown', remaining } };
  }
  return { taps, result: { kind: 'silent' } };
}
