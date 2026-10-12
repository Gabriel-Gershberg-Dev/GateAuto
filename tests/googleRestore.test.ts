import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canTryGoogleRestore } from '../src/auth/googleRestore';

describe('Google session restore', () => {
  it('restores when the saved sign-in is gone and she did not tap Sign out', () => {
    assert.equal(
      canTryGoogleRestore({
        explicitSignOut: false,
        lastAttemptAt: 0,
        now: 10_000,
      }),
      true,
    );
  });

  it('stays signed out after Sign out', () => {
    assert.equal(
      canTryGoogleRestore({
        explicitSignOut: true,
        lastAttemptAt: 0,
        now: 10_000,
      }),
      false,
    );
  });

  it('does not retry in a loop when the new session is rejected', () => {
    assert.equal(
      canTryGoogleRestore({
        explicitSignOut: false,
        lastAttemptAt: 10_000,
        now: 12_000,
      }),
      false,
    );
    assert.equal(
      canTryGoogleRestore({
        explicitSignOut: false,
        lastAttemptAt: 10_000,
        now: 30_000,
      }),
      true,
    );
  });
});
