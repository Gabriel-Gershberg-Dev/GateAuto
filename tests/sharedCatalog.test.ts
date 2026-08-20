import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { displayGateName } from '../src/data/gateDisplay';
import {
  mergeDevicesIntoGateList,
  type GateConfig,
} from '../src/data/gatesStore';
import {
  filterDevicesForSystem,
  isSharedOnlyVault,
  shouldRefreshPalGateCatalog,
  stripLeakedPalGateCatalog,
} from '../src/data/sharedCatalog';
import {
  mergeGateLists,
  pickRecoverableVault,
  type RecoveredGate,
} from '../src/data/vaultRecoverLogic';

function sharedGate(id: string, deviceId: string, name: string): GateConfig {
  return {
    id,
    deviceId,
    systemId: 'sys_shared',
    origin: 'shared',
    sharedInviteCode: '7K3MNP2Q',
    sharedFromName: 'Owner',
    name,
    nameOverride: name,
    enabled: false,
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

function linkedGate(id: string, name: string): GateConfig {
  return {
    id,
    deviceId: id,
    systemId: 'sys_linked',
    origin: 'linked',
    sharedInviteCode: null,
    sharedFromName: null,
    name,
    nameOverride: null,
    enabled: false,
    lat: null,
    lng: null,
    radiusMeters: 50,
    cooldownMs: 30_000,
    holdEnabled: false,
    holdMs: 0,
    bluetooth: { required: false, devices: [] },
    lastOpenedAt: null,
    lastResult: null,
  };
}

function recovered(id: string, origin: 'linked' | 'shared' = 'linked'): RecoveredGate {
  return {
    id,
    deviceId: id,
    systemId: origin === 'shared' ? 'sys_shared' : 'sys_1',
    origin,
    sharedInviteCode: origin === 'shared' ? 'ABCDEFGH' : null,
    sharedFromName: null,
    name: id,
    nameOverride: origin === 'shared' ? `Display ${id}` : null,
    enabled: true,
    lat: 32.16,
    lng: 34.85,
    radiusMeters: 25,
    cooldownMs: 20_000,
    holdEnabled: false,
    holdMs: 0,
    bluetooth: { required: false, devices: [] },
    lastOpenedAt: null,
    lastResult: null,
  };
}

const palgateCatalog = [
  { deviceId: 'a', name: 'שער A' },
  { deviceId: 'b', name: 'שער B' },
  { deviceId: 'c', name: 'שער C' },
  { deviceId: 'd', name: 'שער D' },
];

describe('shared-in PalGate catalog filter', () => {
  it('does not refresh the full PalGate list for a shared-in system', () => {
    assert.equal(shouldRefreshPalGateCatalog({ origin: 'shared' }), false);
    assert.equal(shouldRefreshPalGateCatalog({ origin: 'linked' }), true);
  });

  it('keeps only allowlisted devices for a shared-in system', () => {
    const filtered = filterDevicesForSystem(palgateCatalog, {
      origin: 'shared',
      allowedDeviceIds: ['a', 'b'],
    });
    assert.deepEqual(
      filtered.map((d) => d.deviceId),
      ['a', 'b'],
    );
  });

  it('lets an owner-linked QR system keep the full PalGate catalog', () => {
    const filtered = filterDevicesForSystem(palgateCatalog, {
      origin: 'linked',
      allowedDeviceIds: null,
    });
    assert.equal(filtered.length, 4);
  });

  it('does not add PalGate backend-named extras onto accepted shared gates', () => {
    const existing = [
      sharedGate('share:7K3MNP2Q:a', 'a', 'החנית 1'),
      sharedGate('share:7K3MNP2Q:b', 'b', 'החנית 2'),
    ];
    const merged = mergeDevicesIntoGateList(existing, palgateCatalog, {
      origin: 'shared',
      allowedDeviceIds: ['a', 'b'],
      adoptNewDevices: false,
    });
    assert.equal(merged.length, 2);
    assert.equal(displayGateName(merged[0]), 'החנית 1');
    assert.equal(displayGateName(merged[1]), 'החנית 2');
    assert.equal(merged.every((g) => g.origin === 'shared'), true);
  });

  it('owner QR merge still adopts every PalGate device', () => {
    const merged = mergeDevicesIntoGateList([], palgateCatalog, {
      systemId: 'sys_linked',
      origin: 'linked',
      adoptNewDevices: true,
    });
    assert.equal(merged.length, 4);
    assert.equal(merged.every((g) => g.origin === 'linked'), true);
  });

  it('strips leaked PalGate catalog rows from a share-only vault', () => {
    const gates = [
      sharedGate('share:7K3MNP2Q:a', 'a', 'החנית 1'),
      sharedGate('share:7K3MNP2Q:b', 'b', 'החנית 2'),
      linkedGate('a', 'שער A'),
      linkedGate('b', 'שער B'),
      linkedGate('c', 'שער C'),
      linkedGate('d', 'שער D'),
    ];
    const stripped = stripLeakedPalGateCatalog(gates, [
      { id: 'sys_shared', origin: 'shared', allowedDeviceIds: ['a', 'b'] },
    ]);
    assert.equal(stripped.length, 2);
    assert.equal(stripped[0].id, 'share:7K3MNP2Q:a');
    assert.equal(displayGateName(stripped[1]), 'החנית 2');
  });
});

describe('invitee vault must not adopt owner native/local gates', () => {
  it('treats a share-only list as invitee vault', () => {
    assert.equal(
      isSharedOnlyVault([recovered('share:X:a', 'shared'), recovered('share:X:b', 'shared')]),
      true,
    );
    assert.equal(isSharedOnlyVault([recovered('a'), recovered('b')]), false);
  });

  it('does not copy leftover owner gates onto a shared-in uid', () => {
    const picked = pickRecoverableVault({
      currentUid: 'invitee-uid',
      currentGates: [recovered('share:CODE:a', 'shared'), recovered('share:CODE:b', 'shared')],
      currentSystemCount: 1,
      candidates: [
        {
          uid: 'owner-uid',
          gates: [recovered('a'), recovered('b'), recovered('c'), recovered('d')],
          systemsMeta: [{ id: 'sys_1', label: 'PalGate', origin: 'linked', createdAt: 1 }],
        },
      ],
      isRealAccount: true,
      providers: ['google.com'],
      incomingPendingCount: 0,
      outgoingCount: 0,
    });
    assert.equal(picked, null);
  });

  it('does not append native owner regions onto shared-in gates', () => {
    const merged = mergeGateLists(
      [recovered('share:CODE:a', 'shared'), recovered('share:CODE:b', 'shared')],
      [recovered('a'), recovered('b'), recovered('c'), recovered('d')],
    );
    assert.equal(merged.length, 2);
    assert.equal(merged.every((g) => g.origin === 'shared'), true);
  });
});
