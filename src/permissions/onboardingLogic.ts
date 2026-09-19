/** Post-login Auto-open permission setup — when to sheet vs banner only. */

export type CriticalPermissionId =
  | 'location'
  | 'notifications'
  | 'bluetooth'
  | 'battery';

export type PermissionProbe = {
  locationFg: boolean;
  locationBg: boolean;
  notifications: boolean;
  bluetooth: boolean;
  batteryUnrestricted: boolean;
};

export type OnboardingPersisted = {
  /** User saw the post-login sheet (granted or Later). */
  sheetHandled: boolean;
  /** Last saved probe had every critical permission. */
  lastAllGranted: boolean;
  /** Already showed the one extra sheet after a later revocation. */
  revokedSheetShown: boolean;
};

export const EMPTY_ONBOARDING: OnboardingPersisted = {
  sheetHandled: false,
  lastAllGranted: false,
  revokedSheetShown: false,
};

export function missingCritical(probe: PermissionProbe): CriticalPermissionId[] {
  const missing: CriticalPermissionId[] = [];
  if (!probe.locationFg || !probe.locationBg) missing.push('location');
  if (!probe.notifications) missing.push('notifications');
  if (!probe.bluetooth) missing.push('bluetooth');
  if (!probe.batteryUnrestricted) missing.push('battery');
  return missing;
}

export function parseOnboardingState(raw: unknown): OnboardingPersisted {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_ONBOARDING };
  const v = raw as Record<string, unknown>;
  return {
    sheetHandled: Boolean(v.sheetHandled),
    lastAllGranted: Boolean(v.lastAllGranted),
    revokedSheetShown: Boolean(v.revokedSheetShown),
  };
}

/**
 * Sheet after login (and guest). Skip if they already finished/skipped
 * and nothing was revoked. Banner is separate — show whenever missing.
 */
export function shouldShowPermissionSheet(input: {
  signedIn: boolean;
  missingCount: number;
  state: OnboardingPersisted;
  force: boolean;
}): boolean {
  if (!input.signedIn) return false;
  if (input.missingCount <= 0) return false;
  if (input.force) return true;
  if (!input.state.sheetHandled) return true;
  if (input.state.lastAllGranted && !input.state.revokedSheetShown) return true;
  return false;
}

export function persistAfterPermissionDecision(input: {
  prev: OnboardingPersisted;
  missingCount: number;
  didShowSheet: boolean;
  dismissedLater: boolean;
}): OnboardingPersisted {
  if (input.missingCount <= 0) {
    return {
      sheetHandled: true,
      lastAllGranted: true,
      revokedSheetShown: false,
    };
  }
  const shownRevocation =
    input.prev.lastAllGranted &&
    (input.didShowSheet || input.dismissedLater);
  return {
    sheetHandled:
      input.prev.sheetHandled || input.didShowSheet || input.dismissedLater,
    lastAllGranted: false,
    revokedSheetShown: input.prev.revokedSheetShown || shownRevocation,
  };
}
