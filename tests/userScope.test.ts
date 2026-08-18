import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  asyncKeyForUid,
  sanitizeUid,
  secureKeyForUid,
  shouldAdoptUnscopedVault,
} from '../src/data/userScope';

describe('userScope keys', () => {
  it('namespaces AsyncStorage by uid', () => {
    assert.equal(asyncKeyForUid(null, 'gates'), 'gateauto.u._none.gates');
    assert.equal(
      asyncKeyForUid('EpkWzPDuqugWXrOL963p5ONhObx2', 'gates'),
      'gateauto.u.EpkWzPDuqugWXrOL963p5ONhObx2.gates',
    );
  });

  it('keeps SecureStore keys short and uid-scoped', () => {
    const key = secureKeyForUid('EpkWzPDuqugWXrOL963p5ONhObx2', 'sys.sys_abc.s');
    assert.equal(key.startsWith('ga.EpkWzPDuqugWXrOL963p5ONhObx2.'), true);
    assert.equal(key.length <= 120, true);
  });

  it('sanitizes empty uid to _none', () => {
    assert.equal(sanitizeUid(''), '_none');
    assert.equal(sanitizeUid('@@@'), '_none');
  });
});

describe('unscoped vault adopt', () => {
  it('does not give a guest the previous phone cache', () => {
    assert.equal(
      shouldAdoptUnscopedVault({
        isRealAccount: false,
        incomingPendingCount: 0,
        outgoingCount: 0,
      }),
      false,
    );
  });

  it('does not give an invitee the owner’s full gate list', () => {
    assert.equal(
      shouldAdoptUnscopedVault({
        isRealAccount: true,
        providers: ['password'],
        incomingPendingCount: 1,
        outgoingCount: 0,
      }),
      false,
    );
  });

  it('does not give a password-only invitee leftover owner gates', () => {
    assert.equal(
      shouldAdoptUnscopedVault({
        isRealAccount: true,
        providers: ['password'],
        incomingPendingCount: 0,
        outgoingCount: 0,
      }),
      false,
    );
  });

  it('lets the original Google account reclaim leftover data', () => {
    assert.equal(
      shouldAdoptUnscopedVault({
        isRealAccount: true,
        providers: ['google.com'],
        incomingPendingCount: 0,
        outgoingCount: 0,
      }),
      true,
    );
  });

  it('lets the original sharer reclaim unscoped data', () => {
    assert.equal(
      shouldAdoptUnscopedVault({
        isRealAccount: true,
        providers: ['password'],
        incomingPendingCount: 0,
        outgoingCount: 1,
      }),
      true,
    );
  });
});
