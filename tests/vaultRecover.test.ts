import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  gatesFromNativeRegions,
  initialHubRoute,
  mergeGateLists,
  pickRecoverableVault,
  type RecoveredGate,
} from '../src/data/vaultRecoverLogic';

function gate(id: string, origin: 'linked' | 'shared' = 'linked'): RecoveredGate {
  return {
    id,
    deviceId: id,
    systemId: 'sys_1',
    origin,
    sharedInviteCode: origin === 'shared' ? 'ABCDEFGH' : null,
    sharedFromName: null,
    name: id,
    nameOverride: null,
    enabled: true,
    lat: 32.16,
    lng: 34.85,
    radiusMeters: 25,
    cooldownMs: 20_000,
    holdEnabled: false,
    holdMs: 0,
    bluetooth: { required: true, devices: [{ name: 'car', address: 'AA:BB' }] },
    lastOpenedAt: null,
    lastResult: null,
  };
}

describe('owner vault recovery pick', () => {
  it('adopts leftover uid store into empty Google account', () => {
    const picked = pickRecoverableVault({
      currentUid: 'google-uid',
      currentGates: [],
      currentSystemCount: 0,
      candidates: [
        {
          uid: 'guest-uid',
          gates: [gate('a'), gate('b'), gate('c'), gate('d')],
          systemsMeta: [{ id: 'sys_1', label: 'PalGate', origin: 'linked', createdAt: 1 }],
        },
      ],
      isRealAccount: true,
      providers: ['google.com'],
      incomingPendingCount: 0,
      outgoingCount: 0,
    });
    assert.equal(picked?.uid, 'guest-uid');
    assert.equal(picked?.gates.length, 4);
  });

  it('does not copy owner gates into a password invitee', () => {
    const picked = pickRecoverableVault({
      currentUid: 'invitee-uid',
      currentGates: [],
      currentSystemCount: 0,
      candidates: [
        {
          uid: 'google-uid',
          gates: [gate('a'), gate('b'), gate('c'), gate('d')],
          systemsMeta: [{ id: 'sys_1', label: 'PalGate', origin: 'linked', createdAt: 1 }],
        },
      ],
      isRealAccount: true,
      providers: ['password'],
      incomingPendingCount: 1,
      outgoingCount: 0,
    });
    assert.equal(picked, null);
  });

  it('skips recovery when the Google uid already has a full vault', () => {
    const picked = pickRecoverableVault({
      currentUid: 'google-uid',
      currentGates: [gate('a'), gate('b')],
      currentSystemCount: 1,
      candidates: [
        {
          uid: 'guest-uid',
          gates: [gate('x')],
          systemsMeta: [],
        },
      ],
      isRealAccount: true,
      providers: ['google.com'],
      incomingPendingCount: 0,
      outgoingCount: 1,
    });
    assert.equal(picked, null);
  });
});

describe('native regions and hub', () => {
  it('rebuilds gates from leftover native pin JSON', () => {
    const gates = gatesFromNativeRegions([
      {
        id: '4G300216164',
        deviceId: '4G300216164',
        lat: 32.161822,
        lng: 34.852507,
        radius: 25,
        name: 'מחסום',
        displayName: 'החנית 1',
        cooldownMs: 20000,
        btRequired: true,
        btAddresses: ['C0:C4:F9:50:31:30'],
        btNames: ['MBUX 95663'],
        enabled: true,
      },
    ]);
    assert.equal(gates.length, 1);
    assert.equal(gates[0].nameOverride, 'החנית 1');
    assert.equal(gates[0].bluetooth.required, true);
    assert.equal(gates[0].bluetooth.devices[0]?.address, 'C0:C4:F9:50:31:30');
  });

  it('fills missing pins from a second list without duplicating', () => {
    const merged = mergeGateLists(
      [gate('a')],
      [{ ...gate('a'), lat: 1, lng: 2 }, gate('b')],
    );
    assert.equal(merged.length, 2);
    assert.equal(merged[0].lat, 32.16);
    assert.equal(merged[1].id, 'b');
  });

  it('does not dump native owner gates onto an invitee share-only list', () => {
    const merged = mergeGateLists(
      [gate('share:CODE:a', 'shared'), gate('share:CODE:b', 'shared')],
      [gate('a'), gate('b'), gate('c'), gate('d')],
    );
    assert.equal(merged.length, 2);
    assert.equal(merged.every((g) => g.origin === 'shared'), true);
  });

  it('opens Gates list when gates exist even if PalGate systems are empty', () => {
    assert.equal(initialHubRoute({ gateCount: 4, systemCount: 0 }), 'GatesList');
    assert.equal(initialHubRoute({ gateCount: 0, systemCount: 1 }), 'GatesList');
    assert.equal(initialHubRoute({ gateCount: 0, systemCount: 0 }), 'GateSystems');
  });
});
