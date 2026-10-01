import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  listedCarConnectedForAutoGates,
  needsContinuousLocation,
} from '../src/data/locationDemand';

describe('needsContinuousLocation', () => {
  it('is off when Auto-open is off', () => {
    assert.equal(
      needsContinuousLocation({
        armed: false,
        gates: [{ autoEnabled: true, btRequired: false }],
        listedCarConnected: true,
      }),
      false,
    );
  });

  it('is off when every gate is manual', () => {
    assert.equal(
      needsContinuousLocation({
        armed: true,
        gates: [{ autoEnabled: false, btRequired: false }],
        listedCarConnected: false,
      }),
      false,
    );
  });

  it('stays on when any auto-on gate is proximity-only', () => {
    assert.equal(
      needsContinuousLocation({
        armed: true,
        gates: [
          { autoEnabled: true, btRequired: false },
          { autoEnabled: true, btRequired: true },
        ],
        listedCarConnected: false,
      }),
      true,
    );
  });

  it('waits for the listed car when every auto-on gate requires Bluetooth', () => {
    const gates = [
      { autoEnabled: false, btRequired: false },
      { autoEnabled: true, btRequired: true },
      { autoEnabled: true, btRequired: true },
    ];
    assert.equal(
      needsContinuousLocation({ armed: true, gates, listedCarConnected: false }),
      false,
    );
    assert.equal(
      needsContinuousLocation({ armed: true, gates, listedCarConnected: true }),
      true,
    );
  });

  it('ignores auto-on gates that have no pin', () => {
    assert.equal(
      needsContinuousLocation({
        armed: true,
        gates: [{ autoEnabled: true, btRequired: false, hasPin: false }],
        listedCarConnected: false,
      }),
      false,
    );
  });

  it('counts only a listed car, not random headphones', () => {
    const gates = [
      {
        autoEnabled: true,
        btRequired: true,
        listedAddresses: ['AA:BB:CC:DD:EE:FF'],
        listedNames: ['Audi MMI'],
      },
    ];
    assert.equal(
      listedCarConnectedForAutoGates(gates, ['00:11:22:33:44:55'], ['buds']),
      false,
    );
    assert.equal(
      listedCarConnectedForAutoGates(gates, ['aa:bb:cc:dd:ee:ff'], ['Audi MMI']),
      true,
    );
  });
});

describe('LocationDemand.java stays in sync with the spec', () => {
  const javaDir = path.join(
    process.cwd(),
    'src',
    'platform',
    'android-keepalive',
  );
  const demand = fs.readFileSync(path.join(javaDir, 'LocationDemand.java'), 'utf8');
  const module = fs.readFileSync(path.join(javaDir, 'KeepAliveModule.java'), 'utf8');
  const receiver = fs.readFileSync(path.join(javaDir, 'BtConnectReceiver.java'), 'utf8');
  const monitoring = fs.readFileSync(path.join(javaDir, 'MonitoringService.java'), 'utf8');

  it('waits for a listed car before starting GPS when every auto gate requires Bluetooth', () => {
    assert.ok(demand.includes('UNKNOWN does not'));
    assert.ok(demand.includes('isDemandAuto'));
    assert.ok(demand.includes('requiresListedCar'));
    assert.ok(demand.includes('allowStartLocationFgs'));
    assert.ok(module.includes('LocationDemand.sync('));
    assert.ok(receiver.includes('LocationDemand.sync('));
    assert.ok(monitoring.includes('waiting for listed car Bluetooth'));
  });

  it('applies a sync that lands while another one is running', () => {
    const body = demand.slice(demand.indexOf('public static void sync('));
    assert.ok(body.includes('pending.set(true);'));
    assert.ok(body.includes('while (pending.getAndSet(false))'));
    assert.ok(!body.includes('if (!syncing.compareAndSet(false, true)) return;'));
  });

  it('drops the hold, fences and GPS together when nothing needs location', () => {
    const locked = demand.slice(demand.indexOf('private static void syncLocked'));
    const idle = locked.slice(locked.indexOf('ApproachSampler.stop();'));
    assert.ok(idle.includes('GeofenceRegistrar.unregister(ctx);'));
    assert.ok(idle.includes('HoldService.stop(ctx);'));
    assert.ok(!idle.includes('HoldService.ensure(ctx);'));
    const hold = fs.readFileSync(path.join(javaDir, 'HoldService.java'), 'utf8');
    const ensure = hold.slice(hold.indexOf('public static void ensure'), hold.indexOf('public static void stop'));
    assert.ok(ensure.includes('LocationDemand.needsContinuousLocation(app)'));
  });

  it('never reads location for a Bluetooth device that is not a listed car', () => {
    const open = fs.readFileSync(path.join(javaDir, 'PalGateNativeOpen.java'), 'utf8');
    const bt = open.slice(
      open.indexOf('public static void openFromBluetooth'),
      open.indexOf('public static void pollNearby(Context context)'),
    );
    assert.ok(bt.indexOf('lastLocation(context)') > bt.indexOf('is not a listed car'));
    const wake = open.slice(open.indexOf('public static void onFenceWake'));
    assert.ok(
      wake.indexOf('needsContinuousLocation') < wake.indexOf('currentLocation(context, true)'),
    );
  });

  it('a sticky MonitoringService restart without demand starts no fences or GPS', () => {
    const onCreate = monitoring.slice(
      monitoring.indexOf('public void onCreate()'),
      monitoring.indexOf('private boolean demanded()'),
    );
    assert.ok(onCreate.includes('if (demanded()) startWatching();'));
    assert.ok(!onCreate.includes('startLocationUpdates('));
    assert.ok(!onCreate.includes('GeofenceRegistrar.register('));
  });
});

describe('Expo geofences on Android', () => {
  const geo = fs.readFileSync(path.join(process.cwd(), 'src', 'geo', 'geofencing.ts'), 'utf8');

  it('are never registered next to the native Play fences', () => {
    assert.ok(geo.includes('!needLocation || hasNativeKeepAlive()'));
  });

  it('remove themselves when a leftover one fires', () => {
    for (const fn of ['handleGeofenceEnter', 'handleGeofenceExit']) {
      const body = geo.slice(geo.indexOf(`export async function ${fn}`));
      assert.ok(body.indexOf('dropLeftoverExpoFences()') < body.indexOf('isMonitoringLive()'));
    }
  });
});
