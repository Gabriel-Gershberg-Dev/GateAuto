import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  CAR_BT_SEED_TTL_MS,
  cacheHasListedCar,
  carBtAllowsOpen,
  normalizeBtAddress,
  normalizeBtName,
  resolveCarBtState,
  withConnectedDevice,
  withoutDisconnectedDevice,
  type CarBtRead,
  type CarBtWanted,
} from '../src/bluetooth/carBluetoothCache';

const CAR: CarBtWanted = {
  addresses: ['AA:BB:CC:DD:EE:FF'],
  names: ['Moshe-SNE'],
};

function read(over: Partial<CarBtRead> = {}): CarBtRead {
  return {
    connectGranted: true,
    adapterEnabled: true,
    seeded: true,
    seedAgeMs: 5_000,
    devices: [],
    ...over,
  };
}

describe('car Bluetooth cache matching', () => {
  it('normalizes addresses and names the way the cache keys them', () => {
    assert.equal(normalizeBtAddress('AA:BB:CC:DD:EE:FF'), 'aabbccddeeff');
    assert.equal(normalizeBtAddress('aa-bb-cc-dd-ee-ff'), 'aabbccddeeff');
    assert.equal(normalizeBtAddress(null), '');
    assert.equal(normalizeBtName('  Moshe-SNE '), 'moshe-sne');
  });

  it('matches a listed car by address regardless of separators or case', () => {
    assert.equal(
      cacheHasListedCar([{ key: 'aabbccddeeff', name: 'Whatever' }], CAR),
      true,
    );
  });

  it('matches a listed car by name when the address could not be read', () => {
    // BLUETOOTH_CONNECT can hand back a device with no readable address, which
    // the cache then keys by name.
    assert.equal(cacheHasListedCar([{ key: 'moshe-sne' }], CAR), true);
    assert.equal(
      cacheHasListedCar([{ key: '112233445566', name: 'moshe-sne' }], CAR),
      true,
    );
  });

  it('does not match an unrelated device', () => {
    assert.equal(
      cacheHasListedCar(
        [{ key: '112233445566', name: 'Galaxy Watch' }],
        CAR,
      ),
      false,
    );
    assert.equal(cacheHasListedCar([], CAR), false);
  });

  it('ignores empty criteria instead of matching everything', () => {
    assert.equal(
      cacheHasListedCar([{ key: '', name: '' }], { addresses: [''], names: [''] }),
      false,
    );
  });
});

describe('car Bluetooth tri-state', () => {
  it('reports connected when a listed car is cached', () => {
    assert.equal(
      resolveCarBtState(read({ devices: [{ key: 'aabbccddeeff' }] }), CAR),
      'connected',
    );
  });

  it('reports not_connected only when the set was fully read and is fresh', () => {
    assert.equal(resolveCarBtState(read(), CAR), 'not_connected');
    assert.equal(
      resolveCarBtState(read({ seedAgeMs: CAR_BT_SEED_TTL_MS }), CAR),
      'not_connected',
    );
  });

  it('reports unknown rather than blocking when the set was never fully read', () => {
    assert.equal(resolveCarBtState(read({ seeded: false }), CAR), 'unknown');
  });

  it('reports unknown once the last full read is too old to trust', () => {
    assert.equal(
      resolveCarBtState(read({ seedAgeMs: CAR_BT_SEED_TTL_MS + 1 }), CAR),
      'unknown',
    );
  });

  it('reports unknown without BLUETOOTH_CONNECT, which reads as an empty list', () => {
    assert.equal(
      resolveCarBtState(read({ connectGranted: false }), CAR),
      'unknown',
    );
    // Even a stale-but-seeded cache must not turn a permission gap into a block.
    assert.equal(
      resolveCarBtState(read({ connectGranted: false, seeded: true }), CAR),
      'unknown',
    );
  });

  it('treats Bluetooth being off as a real not_connected answer', () => {
    assert.equal(
      resolveCarBtState(read({ adapterEnabled: false, seeded: false }), CAR),
      'not_connected',
    );
  });

  it('lets Bluetooth being off outrank a cached device that never disconnected', () => {
    assert.equal(
      resolveCarBtState(
        read({ adapterEnabled: false, devices: [{ key: 'aabbccddeeff' }] }),
        CAR,
      ),
      'not_connected',
    );
  });

  it('only ever blocks an open on a confident no', () => {
    assert.equal(carBtAllowsOpen('connected'), true);
    assert.equal(carBtAllowsOpen('unknown'), true);
    assert.equal(carBtAllowsOpen('not_connected'), false);
  });
});

describe('car Bluetooth cache updates from ACL broadcasts', () => {
  it('adds a connected device and de-duplicates it', () => {
    let devices = withConnectedDevice([], { key: 'AABBCCDDEEFF', name: 'Car' });
    assert.deepEqual(devices, [{ key: 'aabbccddeeff', name: 'Car' }]);
    devices = withConnectedDevice(devices, { key: 'aabbccddeeff', name: 'Car' });
    assert.equal(devices.length, 1);
    assert.equal(cacheHasListedCar(devices, CAR), true);
  });

  it('removes a disconnected device so a later open is not gated on stale state', () => {
    const devices = withConnectedDevice([], { key: 'aabbccddeeff', name: 'Car' });
    const after = withoutDisconnectedDevice(devices, 'AA:BB:CC:DD:EE:FF'.replace(/:/g, ''));
    assert.deepEqual(after, []);
    assert.equal(cacheHasListedCar(after, CAR), false);
  });

  it('leaves the set alone for an unkeyed device', () => {
    const devices = [{ key: 'aabbccddeeff' }];
    assert.equal(withConnectedDevice(devices, { key: '' }).length, 1);
    assert.equal(withoutDisconnectedDevice(devices, '').length, 1);
  });
});

describe('CarBluetoothState.java stays in sync with the spec', () => {
  const javaDir = path.join(
    process.cwd(),
    'src',
    'platform',
    'android-keepalive',
  );
  const state = fs.readFileSync(
    path.join(javaDir, 'CarBluetoothState.java'),
    'utf8',
  );
  const open = fs.readFileSync(
    path.join(javaDir, 'PalGateNativeOpen.java'),
    'utf8',
  );

  it('keeps the same tri-state values and TTL', () => {
    for (const literal of [
      'static final int UNKNOWN = -1;',
      'static final int NOT_CONNECTED = 0;',
      'static final int CONNECTED = 1;',
      'SEED_TTL_MS = 6L * 60L * 60_000L',
    ]) {
      assert.ok(state.includes(literal), `CarBluetoothState.java is missing ${literal}`);
    }
    assert.equal(CAR_BT_SEED_TTL_MS, 6 * 60 * 60_000);
  });

  it('never waits on a Bluetooth proxy anywhere in the open path', () => {
    // This is the regression that broke locked-phone opening: a bounded wait for
    // a proxy callback delivered on the main looper, sitting between the
    // geofence and the gate.
    for (const file of [state, open]) {
      assert.ok(!file.includes('CountDownLatch'));
      assert.ok(!file.includes('latch.await'));
      assert.ok(!file.includes('PROFILE_PROXY_WAIT_MS'));
    }
    // The proxies are bound ahead of time and kept, not bound per open.
    assert.ok(state.includes('getProfileProxy'));
    assert.ok(!open.includes('getProfileProxy'));
  });

  it('falls open on an unreadable Bluetooth state instead of skipping the gate', () => {
    assert.ok(open.includes('if (state == CarBluetoothState.UNKNOWN)'));
    assert.ok(open.includes('allowing on proximity'));
    // The only path that returns false is the confident "not connected" one
    // plus the fail-closed "no listed car configured" guard.
    const returns = open
      .slice(open.indexOf('private static boolean bluetoothMatches'))
      .split('\n')
      .filter((line) => line.trim() === 'return false;');
    assert.equal(returns.length, 2);
  });

  it('primes the cache from every service that can hold the process', () => {
    for (const file of ['HoldService.java', 'MonitoringService.java', 'KeepAliveModule.java']) {
      const contents = fs.readFileSync(path.join(javaDir, file), 'utf8');
      assert.ok(
        contents.includes('CarBluetoothState.prime('),
        `${file} does not prime the car Bluetooth cache`,
      );
    }
    assert.ok(open.includes('CarBluetoothState.prime(context)'));
  });

  it('keeps the cache exact with both ACL connect and disconnect', () => {
    const receiver = fs.readFileSync(
      path.join(javaDir, 'BtConnectReceiver.java'),
      'utf8',
    );
    assert.ok(receiver.includes('CarBluetoothState.recordConnected('));
    assert.ok(receiver.includes('CarBluetoothState.recordDisconnected('));
    assert.ok(receiver.includes('ACTION_ACL_DISCONNECTED'));
    const plugin = fs.readFileSync(
      path.join(process.cwd(), 'src', 'platform', 'withAndroidKeepAlive.js'),
      'utf8',
    );
    assert.ok(plugin.includes('android.bluetooth.device.action.ACL_DISCONNECTED'));
    assert.ok(plugin.includes("'CarBluetoothState.java'"));
  });
});
