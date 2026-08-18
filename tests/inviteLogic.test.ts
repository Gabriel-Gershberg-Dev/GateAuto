import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  bytesToInviteCode,
  canTransitionInvite,
  clampInviteCooldownMs,
  clampInviteRadiusMeters,
  inviteGateList,
  INVITE_CODE_LENGTH,
  isRealFirebaseAccount,
  accountHeading,
  isValidInviteCode,
  normalizeInviteCode,
  sharedGateId,
  toInviteGateMap,
} from '../src/share/inviteLogic';

describe('invite codes', () => {
  it('normalizes and validates 8-char codes', () => {
    assert.equal(normalizeInviteCode(' 7k3mnp2q '), '7K3MNP2Q');
    assert.equal(isValidInviteCode('7K3MNP2Q'), true);
    assert.equal(isValidInviteCode('OOOOOOOO'), false);
  });

  it('clamps invite radius and cooldown to Firestore bounds', () => {
    assert.equal(clampInviteRadiusMeters(10), 25);
    assert.equal(clampInviteRadiusMeters(50), 50);
    assert.equal(clampInviteRadiusMeters(400), 250);
    assert.equal(clampInviteCooldownMs(-1), 30_000);
    assert.equal(clampInviteCooldownMs(5_000_000), 3_600_000);
  });

  it('reads a multi-gate invite payload or a legacy single gate', () => {
    const one = inviteGateList({
      gate: { deviceId: 'a', name: 'A', credIndex: 0, radiusMeters: 50, cooldownMs: 30000, bluetooth: { required: false, devices: [] }, systemLabel: 'Home' },
    });
    assert.equal(one.length, 1);
    assert.equal(one[0].deviceId, 'a');
    const many = inviteGateList({
      gates: [
        { deviceId: 'a', name: 'A', credIndex: 0 },
        { deviceId: 'b', name: 'B', credIndex: 0 },
      ],
    });
    assert.equal(many.length, 2);
    assert.equal(many[1].deviceId, 'b');
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
    assert.equal(
      isRealFirebaseAccount({
        isAnonymous: true,
        providers: ['google.com'],
      }),
      true,
    );
    assert.equal(
      isRealFirebaseAccount({
        isAnonymous: false,
        providers: [],
        email: 'ada@gmail.com',
      }),
      true,
    );
  });

  it('labels a leftover Guest name as the Google/email account', () => {
    const guest = accountHeading({
      isRealAccount: false,
      displayName: 'Ada',
      email: null,
    });
    assert.equal(guest.label, 'Guest');
    assert.equal(guest.showUpgrade, true);
    const google = accountHeading({
      isRealAccount: true,
      displayName: 'Guest',
      email: 'ada@gmail.com',
    });
    assert.equal(google.label, 'ada@gmail.com');
    assert.equal(google.showUpgrade, false);
  });

  it('clamps multi-gate invite maps to Firestore bounds', () => {
    const mapped = toInviteGateMap({
      deviceId: 'd'.repeat(200),
      name: 'n'.repeat(200),
      nameOverride: 'o'.repeat(200),
      lat: 91,
      lng: -200,
      radiusMeters: 9,
      cooldownMs: 9_000_000,
      bluetooth: {
        required: true,
        devices: [{ name: 'car'.repeat(40), address: 'aa:bb' }],
      },
      systemLabel: 'sys'.repeat(40),
      credIndex: 3.9,
    });
    assert.equal(mapped.deviceId.length, 120);
    assert.equal(mapped.name.length, 120);
    assert.equal(mapped.nameOverride?.length, 120);
    assert.equal(mapped.lat, null);
    assert.equal(mapped.lng, null);
    assert.equal(mapped.radiusMeters, 25);
    assert.equal(mapped.cooldownMs, 3_600_000);
    assert.equal(mapped.bluetooth.devices[0].name?.length, 80);
    assert.equal(mapped.systemLabel.length, 80);
    assert.equal(mapped.credIndex, 3);
  });

  it('enforces invite status transitions', () => {
    assert.equal(canTransitionInvite('pending', 'accepted', 'invitee'), true);
    assert.equal(canTransitionInvite('pending', 'accepted', 'owner'), false);
    assert.equal(canTransitionInvite('pending', 'revoked', 'owner'), true);
    assert.equal(canTransitionInvite('accepted', 'revoked', 'owner'), true);
    assert.equal(canTransitionInvite('declined', 'accepted', 'invitee'), false);
  });
});
