import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GateConfig } from '../src/data/gatesStore';
import { nativeRegionFromGate } from '../src/platform/nativeRegion';
import { palGateDeviceKey } from '../src/share/inviteLogic';
import {
  applyShareRevokeState,
  disableSharedGatesFromRevoke,
  inviteMatchesUnlinkedSystem,
  isShareDisabled,
  palgateFingerprint,
} from '../src/share/shareRevokeLogic';
import { shouldResumeSettings } from '../src/navigation/resumeRoute';

function sharedGate(
  id: string,
  deviceId: string,
  extras?: Partial<GateConfig>,
): GateConfig {
  return {
    id,
    deviceId,
    systemId: 'sys_shared',
    origin: 'shared',
    sharedInviteCode: '7K3MNP2Q',
    sharedFromName: 'Owner',
    name: deviceId,
    nameOverride: null,
    enabled: true,
    lat: 32.16,
    lng: 34.85,
    radiusMeters: 50,
    cooldownMs: 30_000,
    holdEnabled: false,
    holdMs: 0,
    bluetooth: { required: false, devices: [] },
    lastOpenedAt: null,
    lastResult: null,
    ...extras,
  };
}

function linkedGate(id: string): GateConfig {
  return {
    id,
    deviceId: id,
    systemId: 'sys_linked',
    origin: 'linked',
    sharedInviteCode: null,
    sharedFromName: null,
    name: id,
    nameOverride: null,
    enabled: true,
    lat: 32.16,
    lng: 34.85,
    radiusMeters: 50,
    cooldownMs: 30_000,
    holdEnabled: false,
    holdMs: 0,
    bluetooth: { required: false, devices: [] },
    lastOpenedAt: null,
    lastResult: null,
  };
}

describe('owner unlink disables shared copies', () => {
  it('matches invites by PalGate fingerprint or device id', () => {
    const fp = palgateFingerprint(972501234567, 'AbC');
    assert.equal(fp, palgateFingerprint(972501234567, 'abc'));
    assert.equal(
      inviteMatchesUnlinkedSystem({
        inviteDeviceIds: ['gate-a'],
        packFingerprints: [fp],
        systemFingerprint: fp,
        systemDeviceIds: ['other'],
      }),
      true,
    );
    assert.equal(
      inviteMatchesUnlinkedSystem({
        inviteDeviceIds: ['gate-a'],
        packFingerprints: ['1:nope'],
        systemFingerprint: fp,
        systemDeviceIds: ['gate-a'],
      }),
      true,
    );
    assert.equal(
      inviteMatchesUnlinkedSystem({
        inviteDeviceIds: ['gate-b'],
        packFingerprints: ['1:nope'],
        systemFingerprint: fp,
        systemDeviceIds: ['gate-a'],
      }),
      false,
    );
  });

  it('does not treat share:CODE:deviceId as a PalGate device id', () => {
    assert.equal(palGateDeviceKey({ deviceId: 'abc', id: 'share:7K3MNP2Q:abc' }), 'abc');
    assert.equal(
      palGateDeviceKey({ deviceId: 'share:7K3MNP2Q:abc', id: 'share:7K3MNP2Q:abc' }),
      '',
    );
    assert.equal(
      inviteMatchesUnlinkedSystem({
        inviteDeviceIds: ['share:7K3MNP2Q:a'],
        packFingerprints: ['1:nope'],
        systemFingerprint: '2:fp',
        systemDeviceIds: ['a'],
      }),
      false,
    );
  });

  it('does not disable two of four from the same system when a leftover invite is revoked', () => {
    const gates = [
      sharedGate('share:OLDINV01:a', 'a', { sharedInviteCode: 'OLDINV01' }),
      sharedGate('share:OLDINV01:b', 'b', { sharedInviteCode: 'OLDINV01' }),
      sharedGate('share:NEWINV02:c', 'c', { sharedInviteCode: 'NEWINV02' }),
      sharedGate('share:NEWINV02:d', 'd', { sharedInviteCode: 'NEWINV02' }),
    ];
    gates[0] = { ...gates[0], shareDisabled: true, enabled: false };
    gates[1] = { ...gates[1], shareDisabled: true, enabled: false };
    const { gates: next, changedIds } = applyShareRevokeState(
      gates,
      [
        {
          code: 'OLDINV01',
          deviceIds: ['a', 'b'],
          systemUnlinked: false,
        },
      ],
      [{ code: 'NEWINV02', deviceIds: ['c', 'd'] }],
      [{ id: 'sys_shared', allowedDeviceIds: ['a', 'b', 'c', 'd'] }],
    );
    assert.equal(changedIds.includes('share:OLDINV01:a'), true);
    assert.equal(isShareDisabled(next[0]), false);
    assert.equal(isShareDisabled(next[1]), false);
    assert.equal(isShareDisabled(next[2]), false);
    assert.equal(isShareDisabled(next[3]), false);
    assert.equal(next[2].enabled, true);
  });

  it('disables every shared gate of that PalGate when the owner unlinks', () => {
    const gates = [
      sharedGate('share:OLDINV01:a', 'a', { sharedInviteCode: 'OLDINV01' }),
      sharedGate('share:OLDINV01:b', 'b', { sharedInviteCode: 'OLDINV01' }),
      sharedGate('share:NEWINV02:c', 'c', { sharedInviteCode: 'NEWINV02' }),
      sharedGate('share:NEWINV02:d', 'd', { sharedInviteCode: 'NEWINV02' }),
      linkedGate('own'),
    ];
    const { gates: next, changedIds } = applyShareRevokeState(
      gates,
      [
        {
          code: 'OLDINV01',
          deviceIds: ['a', 'b'],
          systemUnlinked: true,
        },
      ],
      [],
      [{ id: 'sys_shared', allowedDeviceIds: ['a', 'b', 'c', 'd'] }],
    );
    assert.deepEqual(changedIds.sort(), [
      'share:NEWINV02:c',
      'share:NEWINV02:d',
      'share:OLDINV01:a',
      'share:OLDINV01:b',
    ]);
    assert.equal(next.filter((g) => g.origin === 'shared').every(isShareDisabled), true);
    assert.equal(next[4].enabled, true);
    const region = nativeRegionFromGate(next[0]);
    assert.equal(region.enabled, false);
  });

  it('does not disable gates from a different PalGate system', () => {
    const gates = [
      sharedGate('share:AAAAAAA1:a', 'a', {
        systemId: 'sys_a',
        sharedInviteCode: 'AAAAAAA1',
      }),
      sharedGate('share:BBBBBBB2:x', 'x', {
        systemId: 'sys_b',
        sharedInviteCode: 'BBBBBBB2',
      }),
    ];
    const { gates: next, changedIds } = applyShareRevokeState(
      gates,
      [{ code: 'AAAAAAA1', deviceIds: ['a'], systemUnlinked: true }],
      [],
      [
        { id: 'sys_a', allowedDeviceIds: ['a'] },
        { id: 'sys_b', allowedDeviceIds: ['x'] },
      ],
    );
    assert.deepEqual(changedIds, ['share:AAAAAAA1:a']);
    assert.equal(isShareDisabled(next[0]), true);
    assert.equal(isShareDisabled(next[1]), false);
    assert.equal(next[1].enabled, true);
  });

  it('legacy revoked invite with no live share still disables that PalGate', () => {
    const gates = [
      sharedGate('share:7K3MNP2Q:a', 'a'),
      sharedGate('share:OTHERCD1:b', 'b', { sharedInviteCode: 'OTHERCD1' }),
    ];
    const { changedIds } = disableSharedGatesFromRevoke(gates, [
      { code: '7K3MNP2Q', deviceIds: ['a'] },
    ]);
    assert.equal(changedIds.length, 2);
  });

  it('does not delete owner-linked gates', () => {
    const gates = [linkedGate('a')];
    const { gates: next, changedIds } = disableSharedGatesFromRevoke(gates, [
      { code: '7K3MNP2Q', deviceIds: ['a'] },
    ]);
    assert.deepEqual(changedIds, []);
    assert.equal(next[0].enabled, true);
  });
});

describe('sign-out does not resume Settings', () => {
  it('resumes Settings only while signed in', () => {
    assert.equal(shouldResumeSettings(true, 'Settings'), true);
    assert.equal(shouldResumeSettings(false, 'Settings'), false);
    assert.equal(shouldResumeSettings(true, null), false);
  });
});
