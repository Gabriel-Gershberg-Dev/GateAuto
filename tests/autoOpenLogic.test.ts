import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { haversineMeters } from '../src/geo/haversine';
import {
  ABSOLUTE_MAX_OPEN_DISTANCE_M,
  accuracyAcceptable,
  assertNearGate,
  EXIT_RADIUS_FACTOR,
  GOOD_REFINE_ACCURACY_M,
  MAX_REFINE_ACCURACY_M,
  maxOpenDistanceM,
  nativeExitOpenAllowed,
} from '../src/geo/proximity';
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

  it('allows EXIT slightly past the fence (factor 1.1) but not far away', () => {
    const justLeft = assertNearGate(
      { ...PIN, radiusMeters: RADIUS },
      fixAt(54),
      'exit',
    );
    assert.equal(justLeft.ok, true);

    const tooFar = assertNearGate(
      { ...PIN, radiusMeters: RADIUS },
      fixAt(80),
      'exit',
    );
    assert.equal(tooFar.ok, false);
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

  it('caps maxOpenDistanceM at 250m', () => {
    assert.equal(maxOpenDistanceM(5000, 'enter'), ABSOLUTE_MAX_OPEN_DISTANCE_M);
    assert.equal(maxOpenDistanceM(50, 'enter'), 50);
    assert.equal(maxOpenDistanceM(50, 'exit'), 50 * EXIT_RADIUS_FACTOR);
  });
});

describe('nativeExitOpenAllowed — already-inside without Play ENTER', () => {
  it('allows EXIT when we marked inside even if last loc is already far', () => {
    assert.equal(nativeExitOpenAllowed(true, false), true);
  });

  it('skips EXIT with no inside mark and last loc far (false exit / Off→On)', () => {
    assert.equal(nativeExitOpenAllowed(false, false), false);
  });

  it('allows EXIT without an inside mark if last loc still within radius×1.1', () => {
    assert.equal(nativeExitOpenAllowed(false, true), true);
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
