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
  resolveRegisteredDisplayName,
  isValidInviteCode,
  normalizeInviteCode,
  partitionInviteGates,
  toInviteGateMap,
  toShareGateMap,
  canShareGate,
  shareableSelectedIds,
  sharedGateId,
  palGateDeviceKey,
} from '../src/share/inviteLogic';

describe('invite codes', () => {
  it('normalizes and validates 8-char codes', () => {
    assert.equal(normalizeInviteCode(' 7k3mnp2q '), '7K3MNP2Q');
    assert.equal(isValidInviteCode('7K3MNP2Q'), true);
    assert.equal(isValidInviteCode('OOOOOOOO'), false);
  });

  it('clamps invite radius and cooldown to Firestore bounds', () => {
    assert.equal(clampInviteRadiusMeters(10), 10);
    assert.equal(clampInviteRadiusMeters(9), 10);
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

  it('reads PalGate device ids, not share:CODE row ids', () => {
    assert.equal(palGateDeviceKey({ deviceId: 'abc', id: 'share:7K3MNP2Q:abc' }), 'abc');
    assert.equal(
      palGateDeviceKey({ deviceId: 'share:7K3MNP2Q:abc', id: 'share:7K3MNP2Q:abc' }),
      '',
    );
  });

  it('matches invited gates by PalGate deviceId, not share row id', () => {
    const invited = [
      {
        deviceId: 'abc',
        name: 'A',
        nameOverride: 'Home',
        lat: 1,
        lng: 2,
        radiusMeters: 50,
        cooldownMs: 30_000,
        holdEnabled: false,
        holdMs: 0,
        bluetooth: { required: true, devices: [{ name: 'car' }] },
        systemLabel: 'Shared',
        credIndex: 0,
      },
      {
        deviceId: 'xyz',
        name: 'B',
        nameOverride: null,
        lat: null,
        lng: null,
        radiusMeters: 50,
        cooldownMs: 30_000,
        holdEnabled: false,
        holdMs: 0,
        bluetooth: { required: false, devices: [] },
        systemLabel: 'Shared',
        credIndex: 0,
      },
    ];
    const { alreadyHave, toAdd } = partitionInviteGates(invited, [
      { id: 'share:OLDCODE:abc', deviceId: 'abc' },
    ]);
    assert.equal(alreadyHave.length, 1);
    assert.equal(alreadyHave[0].deviceId, 'abc');
    assert.equal(toAdd.length, 1);
    assert.equal(toAdd[0].deviceId, 'xyz');
  });

  it('treats all invited gates as owned when deviceIds already exist', () => {
    const invited = [
      {
        deviceId: 'abc',
        name: 'A',
        nameOverride: null,
        lat: null,
        lng: null,
        radiusMeters: 50,
        cooldownMs: 30_000,
        holdEnabled: false,
        holdMs: 0,
        bluetooth: { required: false, devices: [] },
        systemLabel: 'Shared',
        credIndex: 0,
      },
    ];
    const { alreadyHave, toAdd } = partitionInviteGates(invited, [
      { id: 'abc', deviceId: 'abc' },
    ]);
    assert.equal(toAdd.length, 0);
    assert.equal(alreadyHave.length, 1);
  });

  it('lets owners share and blocks invitees', () => {
    assert.equal(canShareGate({ origin: 'linked' }), true);
    assert.equal(canShareGate({ origin: 'shared' }), false);
    assert.equal(canShareGate({ origin: 'linked', shareDisabled: true }), false);
    assert.equal(canShareGate({ origin: 'shared', shareDisabled: true }), false);
  });

  it('HUD Share only lists selected owner gates', () => {
    assert.deepEqual(
      shareableSelectedIds(
        [
          { id: 'own', origin: 'linked' },
          { id: 'in', origin: 'shared' },
          { id: 'off', origin: 'linked', shareDisabled: true },
        ],
        ['own', 'in', 'off'],
      ),
      ['own'],
    );
    assert.deepEqual(
      shareableSelectedIds([{ id: 'in', origin: 'shared' }], ['in']),
      [],
    );
  });

  it('does not transfer Bluetooth-required on share payloads', () => {
    const mapped = toShareGateMap({
      deviceId: 'abc',
      name: 'A',
      nameOverride: null,
      lat: 32,
      lng: 34,
      radiusMeters: 50,
      cooldownMs: 20_000,
      holdEnabled: true,
      holdMs: 30_000,
      bluetooth: {
        required: true,
        devices: [{ name: 'MBUX', address: 'aa:bb' }],
      },
      systemLabel: 'Home',
      credIndex: 0,
    });
    assert.equal(mapped.bluetooth.required, false);
    assert.deepEqual(mapped.bluetooth.devices, []);
    assert.equal(mapped.name, 'A');
    assert.equal(mapped.radiusMeters, 50);
    assert.equal(mapped.cooldownMs, 20_000);
    assert.equal(mapped.holdEnabled, true);
    assert.equal(mapped.holdMs, 30_000);
    assert.equal(mapped.bluetooth.required, false);
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

  it('keeps the registered name instead of the email local-part', () => {
    assert.equal(
      resolveRegisteredDisplayName({
        explicit: 'Dana',
        authDisplayName: 'dana',
        cloudDisplayName: '',
        email: 'dana@gmail.com',
        isRealAccount: true,
      }),
      'Dana',
    );
    assert.equal(
      resolveRegisteredDisplayName({
        authDisplayName: 'dana',
        cloudDisplayName: 'Dana',
        email: 'dana@gmail.com',
        isRealAccount: true,
      }),
      'Dana',
    );
    assert.equal(
      resolveRegisteredDisplayName({
        authDisplayName: 'Guest',
        googleDisplayName: 'Dana Cohen',
        email: 'dana@gmail.com',
        isRealAccount: true,
      }),
      'Dana Cohen',
    );
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
      holdEnabled: true,
      holdMs: 120_000,
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
    assert.equal(mapped.radiusMeters, 10);
    assert.equal(mapped.cooldownMs, 3_600_000);
    assert.equal(mapped.holdMs, 90_000);
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
