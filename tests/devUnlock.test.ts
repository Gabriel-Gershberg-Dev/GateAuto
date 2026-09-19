import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  DEV_UNLOCK_HASH,
  DEV_UNLOCK_SALT,
  hashesEqual,
  onDevVersionTap,
  saltedPasswordDigest,
  TAPS_TO_BE_A_DEVELOPER,
} from '../src/updates/unlockLogic';

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

describe('developer unlock taps', () => {
  it('is silent for the first two taps, then counts down like Android', () => {
    let taps = 0;
    const kinds: string[] = [];
    for (let i = 0; i < TAPS_TO_BE_A_DEVELOPER; i++) {
      const next = onDevVersionTap({ unlocked: false, tapsBefore: taps });
      taps = next.taps;
      kinds.push(
        next.result.kind === 'countdown'
          ? `countdown:${next.result.remaining}`
          : next.result.kind,
      );
    }
    assert.deepEqual(kinds, [
      'silent',
      'silent',
      'countdown:4',
      'countdown:3',
      'countdown:2',
      'countdown:1',
      'askPassword',
    ]);
    assert.equal(taps, 7);
  });

  it('reopens the password sheet after seven taps without counting again', () => {
    const next = onDevVersionTap({ unlocked: false, tapsBefore: 7 });
    assert.equal(next.result.kind, 'askPassword');
    assert.equal(next.taps, 7);
  });

  it('toasts already-a-developer when unlock is persisted', () => {
    const next = onDevVersionTap({ unlocked: true, tapsBefore: 0 });
    assert.equal(next.result.kind, 'already');
  });
});

describe('salted unlock digest', () => {
  it('stores only hex salt and hash constants', () => {
    assert.match(DEV_UNLOCK_SALT, /^[0-9a-f]{32}$/);
    assert.match(DEV_UNLOCK_HASH, /^[0-9a-f]{64}$/);
  });

  it('accepts a matching dummy digest and rejects a wrong password', () => {
    const salt = 'aabbccddeeff00112233445566778899';
    const digest = saltedPasswordDigest(salt, 'dummy-unlock', sha256Hex);
    assert.equal(
      hashesEqual(digest, saltedPasswordDigest(salt, 'dummy-unlock', sha256Hex)),
      true,
    );
    assert.equal(
      hashesEqual(digest, saltedPasswordDigest(salt, 'nope', sha256Hex)),
      false,
    );
  });
});
