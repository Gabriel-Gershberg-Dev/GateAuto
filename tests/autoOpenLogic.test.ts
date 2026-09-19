import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { haversineMeters } from '../src/geo/haversine';
import {
  ABSOLUTE_MAX_OPEN_DISTANCE_M,
  accuracyAcceptable,
  assertNearGate,
  configuredOpenMaxM,
  EXIT_RADIUS_FACTOR,
  GOOD_REFINE_ACCURACY_M,
  MAX_REFINE_ACCURACY_M,
  maxOpenDistanceM,
  nativeExitOpenAllowed,
  nativeEnterOpenAllowed,
  playDetectRadiusM,
  playOpenAllowed,
  shouldWaitForHighGps,
} from '../src/geo/proximity';
import { nativeRegionFromGate } from '../src/platform/nativeRegion';
import { cooldownRemainingMs } from '../src/geo/cooldown';
import { bannerTopOffset } from '../src/ui/bannerInset';

const PIN = { lat: 32.0853, lng: 34.7818 };
const RADIUS = 50;

function fixAt(metersNorth: number, accuracy = 8, ageMs = 500): {
  lat: number;
  lng: number;
  accuracy: number;
  ageMs: number;
  timestamp: number;
} {
  // ~111_320 m per degree latitude
  const lat = PIN.lat + metersNorth / 111_320;
  return {
    lat,
    lng: PIN.lng,
    accuracy,
    ageMs,
    timestamp: Date.now() - ageMs,
  };
}

describe('haversineMeters', () => {
  it('is ~0 for the same point', () => {
    assert.ok(haversineMeters(PIN, PIN) < 0.01);
  });

  it('is about 111km for 1 degree of latitude', () => {
    const d = haversineMeters(PIN, { lat: PIN.lat + 1, lng: PIN.lng });
    assert.ok(d > 110_000 && d < 112_000);
  });
});

describe('assertNearGate — far-away protection', () => {
  it('allows a fix inside the configured radius', () => {
    const near = assertNearGate(
      { ...PIN, radiusMeters: RADIUS },
      fixAt(10),
      'enter',
    );
    assert.equal(near.ok, true);
    if (near.ok) {
      assert.ok(near.distanceM < 15);
      assert.equal(near.maxDistanceM, RADIUS);
    }
  });

  it('rejects a fix just outside the radius on ENTER', () => {
    const far = assertNearGate(
      { ...PIN, radiusMeters: RADIUS },
      fixAt(80),
      'enter',
    );
    assert.equal(far.ok, false);
  });

  it('allows EXIT only within the configured radius (no silent ×2 / 50m floor)', () => {
    const justLeft = assertNearGate(
      { ...PIN, radiusMeters: RADIUS },
      fixAt(54),
      'exit',
    );
    assert.equal(justLeft.ok, false);

    const overshoot = assertNearGate(
      { ...PIN, radiusMeters: RADIUS },
      fixAt(80),
      'exit',
    );
    assert.equal(overshoot.ok, false);

    const stillInside = assertNearGate(
      { ...PIN, radiusMeters: RADIUS },
      fixAt(10),
      'exit',
    );
    assert.equal(stillInside.ok, true);

    const twentyFive = assertNearGate(
      { ...PIN, radiusMeters: 25 },
      fixAt(67),
      'exit',
    );
    assert.equal(twentyFive.ok, false);
    if (!twentyFive.ok) {
      assert.equal(twentyFive.maxDistanceM, 25);
      assert.match(twentyFive.detail, /25\.0m/);
      assert.doesNotMatch(twentyFive.detail, /50\.0m/);
    }
  });

  it('never opens beyond the 250m sanity cap even with a huge radius', () => {
    const huge = assertNearGate(
      { ...PIN, radiusMeters: 5000 },
      fixAt(400),
      'enter',
    );
    assert.equal(huge.ok, false);
    if (!huge.ok) {
      assert.equal(huge.maxDistanceM, ABSOLUTE_MAX_OPEN_DISTANCE_M);
      assert.match(huge.detail, /absolute cap/);
    }
  });

  it('caps maxOpenDistanceM at 250m and uses the user radius for EXIT', () => {
    assert.equal(maxOpenDistanceM(5000, 'enter'), ABSOLUTE_MAX_OPEN_DISTANCE_M);
    assert.equal(maxOpenDistanceM(50, 'enter'), 50);
    assert.equal(maxOpenDistanceM(50, 'exit'), 50 * EXIT_RADIUS_FACTOR);
    assert.equal(maxOpenDistanceM(25, 'exit'), 25);
    assert.equal(configuredOpenMaxM(25), 25);
  });
});

describe('playOpenAllowed — configured radius, not 250m city cap', () => {
  it('skips Play ENTER at 67m on a 25m pin (Moshe Sneh case)', () => {
    const r = playOpenAllowed(25, 67.1, 67.1);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.match(r.detail, /radius 25\.0m/);
      assert.doesNotMatch(r.detail, /city cap/);
    }
    assert.equal(nativeEnterOpenAllowed(25, false, 67.1, 67.1), false);
  });

  it('opens immediately when triggering loc is inside radius even if last loc is 67m', () => {
    const r = playOpenAllowed(25, 18.2, 67.1);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.source, 'triggering');
      assert.ok(r.distanceM < 25);
    }
  });

  it('opens when last loc is inside even if Play triggering loc is outside', () => {
    const r = playOpenAllowed(25, 67.1, 12);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.source, 'last');
    }
  });

  it('skips when last loc and triggering loc are both missing', () => {
    const r = playOpenAllowed(25, null, null);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.match(r.detail, /no location/);
    }
    assert.equal(nativeEnterOpenAllowed(25, true, Number.NaN), false);
    assert.equal(nativeExitOpenAllowed(25, true, Number.NaN), false);
  });

  it('skips EXIT of other pins at 112m / 246m against a 25m radius (not 50m)', () => {
    const nearby = playOpenAllowed(25, 112.8, 112.8);
    assert.equal(nearby.ok, false);
    if (!nearby.ok) {
      assert.equal(nearby.maxDistanceM, 25);
      assert.match(nearby.detail, /radius 25\.0m/);
    }
    const far = playOpenAllowed(25, 246.5, 246.5);
    assert.equal(far.ok, false);
    if (!far.ok) {
      assert.match(far.detail, /radius 25\.0m/);
    }
  });

  it('uses 250m only as a city-garbage cap, not the open threshold', () => {
    assert.equal(playOpenAllowed(25, 180, 180).ok, false);
    assert.equal(nativeExitOpenAllowed(25, false, 180), false);
    const city = playOpenAllowed(25, 400, 400);
    assert.equal(city.ok, false);
    if (!city.ok) {
      assert.match(city.detail, /city cap/);
    }
    assert.equal(nativeEnterOpenAllowed(25, false, 400), false);
  });

  it('passes the user 25m radius to native with no 50m floor', () => {
    const region = nativeRegionFromGate({
      id: 'gate-1',
      deviceId: '4G300203774',
      systemId: null,
      origin: 'linked',
      sharedInviteCode: null,
      sharedFromName: null,
      name: 'משה סנה 2',
      nameOverride: null,
      enabled: true,
      lat: 32.162,
      lng: 34.843,
      radiusMeters: 25,
      cooldownMs: 10_000,
      holdEnabled: false,
      holdMs: 0,
      bluetooth: { required: false, devices: [] },
      lastOpenedAt: null,
      lastResult: null,
    });
    assert.equal(region.radius, 25);
  });

  it('detects with a 100m Play fence but still only opens at the user 25m radius', () => {
    assert.equal(playDetectRadiusM(25), 100);
    assert.equal(playDetectRadiusM(40), 100);
    assert.equal(playDetectRadiusM(150), 150);
    assert.equal(playDetectRadiusM(300), ABSOLUTE_MAX_OPEN_DISTANCE_M);
    assert.equal(playDetectRadiusM(0), 0);
    assert.equal(playOpenAllowed(25, 67.1, 67.1).ok, false);
    assert.equal(playOpenAllowed(25, 18, 18).ok, true);
  });
});

describe('shouldWaitForHighGps', () => {
  it('never waits on poll (headless High GPS hung the 30s ticker)', () => {
    assert.equal(shouldWaitForHighGps('poll', false), false);
    assert.equal(shouldWaitForHighGps('poll', true), false);
  });

  it('does not wait when already inside the configured radius', () => {
    assert.equal(shouldWaitForHighGps('enter', true), false);
    assert.equal(shouldWaitForHighGps('exit', true), false);
    assert.equal(shouldWaitForHighGps('bt_connect', true), false);
  });

  it('still waits for High GPS on ENTER when last loc is outside', () => {
    assert.equal(shouldWaitForHighGps('enter', false), true);
    assert.equal(shouldWaitForHighGps('exit', false), true);
    assert.equal(shouldWaitForHighGps('manual_test', false), true);
  });
});

describe('accuracyAcceptable', () => {
  it('accepts good accuracy inside the fence', () => {
    assert.equal(accuracyAcceptable(8, 10, RADIUS).ok, true);
    assert.equal(accuracyAcceptable(GOOD_REFINE_ACCURACY_M, 10, RADIUS).ok, true);
  });

  it('rejects accuracy worse than MAX', () => {
    const r = accuracyAcceptable(MAX_REFINE_ACCURACY_M + 1, 5, RADIUS);
    assert.equal(r.ok, false);
  });

  it('rejects marginal accuracy when uncertainty spills outside the fence', () => {
    const r = accuracyAcceptable(55, 10, RADIUS);
    assert.equal(r.ok, false);
  });

  it('accepts marginal accuracy when distance+accuracy still fits in radius', () => {
    const r = accuracyAcceptable(55, 0, 80);
    assert.equal(r.ok, true);
  });
});

describe('cooldownRemainingMs', () => {
  const now = 1_000_000;

  it('allows open when never opened', () => {
    assert.equal(cooldownRemainingMs(null, 10_000, now), 0);
  });

  it('blocks until configured cooldown elapses', () => {
    assert.equal(cooldownRemainingMs(now - 3_000, 10_000, now), 7_000);
    assert.equal(cooldownRemainingMs(now - 10_000, 10_000, now), 0);
    assert.equal(cooldownRemainingMs(now - 11_000, 10_000, now), 0);
  });

  it('does not invent a 90s debounce — 10s cooldown is 10s', () => {
    assert.ok(cooldownRemainingMs(now - 10_000, 10_000, now) === 0);
    assert.ok(cooldownRemainingMs(now - 11_000, 90_000, now) > 0);
  });
});

describe('bannerTopOffset', () => {
  it('uses the larger of safe-area inset and status bar height', () => {
    assert.equal(bannerTopOffset(52, 24, 'android'), 52);
    assert.equal(bannerTopOffset(0, 47, 'android'), 47);
  });

  it('falls back on Android when both metrics are 0 (edge-to-edge race)', () => {
    assert.equal(bannerTopOffset(0, 0, 'android'), 48);
    assert.equal(bannerTopOffset(0, 0, 'ios'), 12);
  });
});
