import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  bytesToInviteCode,
  canTransitionInvite,
  INVITE_CODE_LENGTH,
  isRealFirebaseAccount,
  isValidInviteCode,
  normalizeInviteCode,
  sharedGateId,
} from '../src/share/inviteLogic';

describe('invite codes', () => {
  it('normalizes and validates 8-char codes', () => {
    assert.equal(normalizeInviteCode(' 7k3mnp2q '), '7K3MNP2Q');
    assert.equal(isValidInviteCode('7K3MNP2Q'), true);
    assert.equal(isValidInviteCode('OOOOOOOO'), false);
  });

  it('builds a shared gate id from code + device', () => {
    assert.equal(sharedGateId('7K3MNP2Q', 'abc'), 'share:7K3MNP2Q:abc');
  });

  it('maps random bytes to alphabet without 0/O/1/I', () => {
    const code = bytesToInviteCode(Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8]));
    assert.equal(code.length, INVITE_CODE_LENGTH);
    assert.equal(isValidInviteCode(code), true);
  });
});

describe('account + invite transitions', () => {
  it('requires Google or email, not guest', () => {
    assert.equal(
      isRealFirebaseAccount({ isAnonymous: true, providers: [] }),
      false,
    );
    assert.equal(
      isRealFirebaseAccount({
        isAnonymous: false,
        providers: ['google.com'],
      }),
      true,
    );
    assert.equal(
      isRealFirebaseAccount({
        isAnonymous: false,
        providers: ['password'],
      }),
      true,
    );
  });

  it('enforces invite status transitions', () => {
    assert.equal(canTransitionInvite('pending', 'accepted', 'invitee'), true);
    assert.equal(canTransitionInvite('pending', 'accepted', 'owner'), false);
    assert.equal(canTransitionInvite('pending', 'revoked', 'owner'), true);
    assert.equal(canTransitionInvite('accepted', 'revoked', 'owner'), true);
    assert.equal(canTransitionInvite('declined', 'accepted', 'invitee'), false);
  });
});
