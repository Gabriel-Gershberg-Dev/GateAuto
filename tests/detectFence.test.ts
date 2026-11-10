import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  ABSOLUTE_MAX_OPEN_DISTANCE_M,
  MIN_PLAY_DETECT_RADIUS_M,
  playDetectRadiusM,
} from '../src/geo/proximity';

describe('play detect vs open radius', () => {
  it('floors Play detect at 100m so a 25m pin still wakes the process', () => {
    assert.equal(MIN_PLAY_DETECT_RADIUS_M, 100);
    assert.equal(playDetectRadiusM(25), 100);
    assert.equal(playDetectRadiusM(40), 100);
    assert.equal(playDetectRadiusM(100), 100);
    assert.equal(playDetectRadiusM(150), 150);
    assert.equal(playDetectRadiusM(400), ABSOLUTE_MAX_OPEN_DISTANCE_M);
  });

  it('pins the native Java literals to the same 100m floor and 250m cap', () => {
    const java = fs.readFileSync(
      path.join(
        __dirname,
        '../src/platform/android-keepalive/GeofenceRegistrar.java',
      ),
      'utf8',
    );
    assert.match(java, /DETECT_MIN_M = 100\.0/);
    assert.match(java, /DETECT_MAX_M = 250\.0/);
    assert.match(java, /detectRadiusMeters\(radius\)/);
    assert.doesNotMatch(
      java,
      /\.setCircularRegion\(lat, lng, \(float\) radius\)/,
    );
  });

  it('does not reintroduce a stale last-loc shortcut in the native poll', () => {
    const java = fs.readFileSync(
      path.join(
        __dirname,
        '../src/platform/android-keepalive/PalGateNativeOpen.java',
      ),
      'utf8',
    );
    assert.match(java, /FRESH_LOC_MAX_AGE_MS = 8_000L/);
    assert.match(java, /ApproachSampler/);
    assert.match(java, /PRIORITY_HIGH_ACCURACY/);
  });

  it('samples at 1Hz once approaching so the user radius is crossed instantly', () => {
    const monitor = fs.readFileSync(
      path.join(
        __dirname,
        '../src/platform/android-keepalive/MonitoringService.java',
      ),
      'utf8',
    );
    assert.match(monitor, /LOCATION_NEAR_INTERVAL_MS = 1_000L/);
    assert.match(monitor, /LOCATION_INTERVAL_MS = 5_000L/);
    assert.doesNotMatch(monitor, /PRIORITY_BALANCED_POWER_ACCURACY,\s*LOCATION_INTERVAL_MS/);
    assert.match(monitor, /pollNearby\(app, "poll", loc\)/);
    assert.match(monitor, /FIX_STALL_MS = 25_000L/);
    assert.match(monitor, /KeepAliveScheduler\.BACKGROUND_INTERVAL_MS/);
    const sampler = fs.readFileSync(
      path.join(
        __dirname,
        '../src/platform/android-keepalive/ApproachSampler.java',
      ),
      'utf8',
    );
    assert.match(sampler, /INTERVAL_MS = 1_000L/);
    assert.match(sampler, /PRIORITY_HIGH_ACCURACY/);
    assert.match(sampler, /SESSION_MAX_MS = 90_000L/);
    assert.match(sampler, /BURST_MAX_MS = 10 \* 60 \* 1000L/);
    assert.match(sampler, /CAR_BURST_MAX_MS = 45 \* 60 \* 1000L/);
    assert.match(sampler, /public static void startForCar/);
    const bt = fs.readFileSync(
      path.join(
        __dirname,
        '../src/platform/android-keepalive/BtConnectReceiver.java',
      ),
      'utf8',
    );
    assert.match(bt, /ApproachSampler.startForCar\(app\)/);
    assert.match(bt, /AutoOpenLog.car\(context, true\)/);
    const open = fs.readFileSync(
      path.join(
        __dirname,
        '../src/platform/android-keepalive/PalGateNativeOpen.java',
      ),
      'utf8',
    );
    const btOpen = open.slice(
      open.indexOf('public static void openFromBluetooth'),
      open.indexOf('public static boolean listedCarForAutoGate'),
    );
    assert.match(btOpen, /requestCurrentOrLast\(context\)/);
    const scheduler = fs.readFileSync(
      path.join(
        __dirname,
        '../src/platform/android-keepalive/KeepAliveScheduler.java',
      ),
      'utf8',
    );
    assert.match(scheduler, /BACKGROUND_INTERVAL_MS = 60 \* 1000L/);
    assert.match(scheduler, /MonitoringService.isForeground\(\)/);
    const receiver = fs.readFileSync(
      path.join(
        __dirname,
        '../src/platform/android-keepalive/KeepAliveReceiver.java',
      ),
      'utf8',
    );
    assert.match(
      receiver,
      /if \(!alarm && KeepAliveScheduler\.shouldThrottle\(context\)\)/,
    );
    const boot = fs.readFileSync(
      path.join(__dirname, '../src/platform/withAndroidBootSync.js'),
      'utf8',
    );
    assert.match(boot, /KeepAliveReceiver.bootPoll/);
  });
});
