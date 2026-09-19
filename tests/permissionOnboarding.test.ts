import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EMPTY_ONBOARDING,
  missingCritical,
  parseOnboardingState,
  persistAfterPermissionDecision,
  shouldShowPermissionSheet,
  type PermissionProbe,
} from '../src/permissions/onboardingLogic';

const granted: PermissionProbe = {
  locationFg: true,
  locationBg: true,
  notifications: true,
  bluetooth: true,
  batteryUnrestricted: true,
};

describe('auto-open permission onboarding', () => {
  it('lists only the critical gaps', () => {
    assert.deepEqual(missingCritical(granted), []);
    assert.deepEqual(
      missingCritical({ ...granted, locationBg: false }),
      ['location'],
    );
    assert.deepEqual(
      missingCritical({
        locationFg: false,
        locationBg: false,
        notifications: false,
        bluetooth: false,
        batteryUnrestricted: false,
      }),
      ['location', 'notifications', 'bluetooth', 'battery'],
    );
  });

  it('does not sheet on Sign in or when everything is granted', () => {
    assert.equal(
      shouldShowPermissionSheet({
        signedIn: false,
        missingCount: 2,
        state: EMPTY_ONBOARDING,
        force: false,
      }),
      false,
    );
    assert.equal(
      shouldShowPermissionSheet({
        signedIn: true,
        missingCount: 0,
        state: EMPTY_ONBOARDING,
        force: false,
      }),
      false,
    );
  });

  it('sheets after login (including guest) when something is missing', () => {
    assert.equal(
      shouldShowPermissionSheet({
        signedIn: true,
        missingCount: 1,
        state: EMPTY_ONBOARDING,
        force: false,
      }),
      true,
    );
  });

  it('does not spam cold start after Later, but banner force still opens', () => {
    const afterLater = persistAfterPermissionDecision({
      prev: EMPTY_ONBOARDING,
      missingCount: 2,
      didShowSheet: true,
      dismissedLater: true,
    });
    assert.equal(afterLater.sheetHandled, true);
    assert.equal(afterLater.lastAllGranted, false);
    assert.equal(
      shouldShowPermissionSheet({
        signedIn: true,
        missingCount: 2,
        state: afterLater,
        force: false,
      }),
      false,
    );
    assert.equal(
      shouldShowPermissionSheet({
        signedIn: true,
        missingCount: 2,
        state: afterLater,
        force: true,
      }),
      true,
    );
  });

  it('skips the sheet when setup completed and still granted', () => {
    const done = persistAfterPermissionDecision({
      prev: EMPTY_ONBOARDING,
      missingCount: 0,
      didShowSheet: true,
      dismissedLater: false,
    });
    assert.equal(done.lastAllGranted, true);
    assert.equal(
      shouldShowPermissionSheet({
        signedIn: true,
        missingCount: 0,
        state: done,
        force: false,
      }),
      false,
    );
  });

  it('shows the sheet once if permissions are later revoked', () => {
    const done = persistAfterPermissionDecision({
      prev: EMPTY_ONBOARDING,
      missingCount: 0,
      didShowSheet: true,
      dismissedLater: false,
    });
    assert.equal(
      shouldShowPermissionSheet({
        signedIn: true,
        missingCount: 1,
        state: done,
        force: false,
      }),
      true,
    );
    const afterRevokeSheet = persistAfterPermissionDecision({
      prev: done,
      missingCount: 1,
      didShowSheet: true,
      dismissedLater: false,
    });
    assert.equal(afterRevokeSheet.revokedSheetShown, true);
    assert.equal(
      shouldShowPermissionSheet({
        signedIn: true,
        missingCount: 1,
        state: afterRevokeSheet,
        force: false,
      }),
      false,
    );
  });

  it('parses persisted JSON without throwing', () => {
    assert.deepEqual(parseOnboardingState(null), EMPTY_ONBOARDING);
    assert.equal(
      parseOnboardingState({ sheetHandled: 1, lastAllGranted: true }).lastAllGranted,
      true,
    );
  });
});
