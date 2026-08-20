import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GateConfig } from '../src/data/gatesStore';
import { nativeRegionFromGate } from '../src/platform/nativeRegion';
import {
  disableSharedGatesFromRevoke,
  inviteMatchesUnlinkedSystem,
  isShareDisabled,
  palgateFingerprint,
} from '../src/share/shareRevokeLogic';

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

  it('disables matching shared-in rows and leaves them in the list', () => {
    const gates = [
      sharedGate('share:7K3MNP2Q:a', 'a'),
      sharedGate('share:OTHER:b', 'b', { sharedInviteCode: 'OTHERCD1' }),
      linkedGate('own'),
    ];
    const { gates: next, changedIds } = disableSharedGatesFromRevoke(gates, [
      { code: '7K3MNP2Q', deviceIds: ['a'] },
    ]);
    assert.deepEqual(changedIds, ['share:7K3MNP2Q:a']);
    assert.equal(next.length, 3);
    assert.equal(isShareDisabled(next[0]), true);
    assert.equal(next[0].enabled, false);
    assert.equal(isShareDisabled(next[1]), false);
    assert.equal(next[2].enabled, true);
    const region = nativeRegionFromGate(next[0]);
    assert.equal(region.enabled, false);
  });

  it('also matches shared copies by device id when the invite code differs', () => {
    const gates = [
      sharedGate('share:ZZZZZZZZ:a', 'a', { sharedInviteCode: 'ZZZZZZZZ' }),
    ];
    const { changedIds } = disableSharedGatesFromRevoke(gates, [
      { code: '7K3MNP2Q', deviceIds: ['a'] },
    ]);
    assert.deepEqual(changedIds, ['share:ZZZZZZZZ:a']);
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
