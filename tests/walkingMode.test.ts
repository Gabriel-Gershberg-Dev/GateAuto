import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { needsContinuousLocation } from '../src/data/locationDemand';
import {
  bearingDegrees,
  footOpenApplies,
  walkingAccuracyOk,
  walkingHeadingAllows,
  walkingOpenMaxM,
} from '../src/data/walkingMode';

describe('walkingOpenMaxM', () => {
  it('opens a 50 m pin at 7 m or 12 m', () => {
    assert.equal(walkingOpenMaxM(50, 'normal'), 7);
    assert.equal(walkingOpenMaxM(50, 'high'), 12);
    assert.equal(walkingOpenMaxM(150, 'normal'), 7);
  });

  it('never grows a small pin', () => {
    assert.equal(walkingOpenMaxM(10, 'normal'), 7);
    assert.equal(walkingOpenMaxM(10, 'high'), 10);
    assert.equal(walkingOpenMaxM(4, 'normal'), 4);
    assert.equal(walkingOpenMaxM(6, 'high'), 6);
  });
});

describe('footOpenApplies', () => {
  it('keeps the car path when the listed car is connected', () => {
    assert.equal(
      footOpenApplies({
        walkingEnabled: true,
        btRequired: true,
        listedCarConnected: true,
      }),
      false,
    );
  });

  it('uses walking when the car is not connected', () => {
    assert.equal(
      footOpenApplies({
        walkingEnabled: true,
        btRequired: true,
        listedCarConnected: false,
      }),
      true,
    );
  });

  it('motion on foot overrides a still-connected car', () => {
    assert.equal(
      footOpenApplies({
        walkingEnabled: false,
        motionEnabled: true,
        activity: 'on_foot',
        btRequired: true,
        listedCarConnected: true,
      }),
      true,
    );
  });

  it('motion in a vehicle keeps the car path', () => {
    assert.equal(
      footOpenApplies({
        walkingEnabled: true,
        motionEnabled: true,
        activity: 'in_vehicle',
        btRequired: true,
        listedCarConnected: false,
      }),
      false,
    );
  });

  it('stays off when Walking is off', () => {
    assert.equal(
      footOpenApplies({
        walkingEnabled: false,
        btRequired: true,
        listedCarConnected: false,
      }),
      false,
    );
  });
});

describe('walking heading and accuracy', () => {
  it('allows a missing bearing and blocks a clear away heading', () => {
    assert.equal(
      walkingHeadingAllows({
        speedMps: 1.5,
        bearingDeg: null,
        bearingToPinDeg: 10,
      }),
      true,
    );
    assert.equal(
      walkingHeadingAllows({
        speedMps: 0.2,
        bearingDeg: 180,
        bearingToPinDeg: 0,
      }),
      true,
    );
    assert.equal(
      walkingHeadingAllows({
        speedMps: 1.5,
        bearingDeg: 180,
        bearingToPinDeg: 0,
      }),
      false,
    );
    assert.equal(
      walkingHeadingAllows({
        speedMps: 1.5,
        bearingDeg: 20,
        bearingToPinDeg: 0,
      }),
      true,
    );
  });

  it('accepts a loose fix and rejects a very loose one', () => {
    assert.equal(walkingAccuracyOk(15), true);
    assert.equal(walkingAccuracyOk(Number.POSITIVE_INFINITY), true);
    assert.equal(walkingAccuracyOk(40), false);
  });

  it('computes a northward bearing', () => {
    const bearing = bearingDegrees(32, 34, 32.01, 34);
    assert.ok(bearing != null && bearing < 5);
  });
});

describe('walking keeps the GPS stream on', () => {
  it('demands GPS while Walking is on even if the car is not connected', () => {
    assert.equal(
      needsContinuousLocation({
        armed: true,
        gates: [{ autoEnabled: true, btRequired: true }],
        listedCarConnected: false,
        walkingEnabled: true,
      }),
      true,
    );
  });

  it('still waits for the listed car when Walking is off', () => {
    assert.equal(
      needsContinuousLocation({
        armed: true,
        gates: [{ autoEnabled: true, btRequired: true }],
        listedCarConnected: false,
      }),
      false,
    );
  });

  it('keeps Play fences without starting the location service from a background sync', () => {
    const java = fs.readFileSync(
      path.join(
        process.cwd(),
        'src',
        'platform',
        'android-keepalive',
        'LocationDemand.java',
      ),
      'utf8',
    );
    const open = fs.readFileSync(
      path.join(
        process.cwd(),
        'src',
        'platform',
        'android-keepalive',
        'PalGateNativeOpen.java',
      ),
      'utf8',
    );
    assert.ok(java.includes('needsPlayFences'));
    assert.ok(java.includes('KeepAlivePrefs.walkingEnabled'));
    const locked = java.slice(java.indexOf('private static void syncLocked'));
    const walk = locked.slice(locked.indexOf('} else if (fences)'));
    assert.ok(walk.includes('GeofenceRegistrar.register'));
    assert.ok(!walk.slice(0, walk.indexOf('} else {')).includes('MonitoringService.start'));
    for (const literal of [
      'WALKING_NORMAL_MAX_M = 7',
      'WALKING_NORMAL_FLOOR_M = 5',
      'WALKING_HIGH_MAX_M = 12',
      'WALKING_HIGH_FLOOR_M = 8',
      'WALKING_HEADING_MIN_SPEED_MPS = 1.2f',
      'WALKING_HEADING_AWAY_DEG = 100f',
    ]) {
      assert.ok(open.includes(literal), literal);
    }
    const bt = open.slice(
      open.indexOf('public static void openFromBluetooth'),
      open.indexOf('public static void pollNearby(Context context)'),
    );
    assert.ok(bt.includes('withinFence(gate, last, 1.0)'));
    assert.ok(!bt.includes('withinOpen('));
    const play = open.slice(open.indexOf('private static PlayOpenCheck resolvePlayOpen'));
    assert.ok(play.includes('openRadiusMeters(context, gate)'));
    assert.ok(
      play.indexOf('openRadiusMeters(context, gate)') <
        play.indexOf('distanceMeters(gate, triggering)'),
    );
  });
});
