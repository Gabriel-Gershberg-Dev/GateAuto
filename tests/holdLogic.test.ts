import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cooldownRemainingMs } from '../src/geo/cooldown';
import {
  cooldownStartAt,
  effectiveHoldMs,
  holdPulseIntervalMs,
  isHoldActive,
  isSittingAutoTrigger,
  MAX_HOLD_MS,
  nextHoldPulseDelayMs,
  normalizeHoldMs,
  shouldRestartHoldFromAuto,
} from '../src/geo/holdLogic';
import { nativeRegionFromGate } from '../src/platform/nativeRegion';

describe('normalizeHoldMs', () => {
  it('caps at 90 seconds and treats small values as seconds', () => {
    assert.equal(normalizeHoldMs(90_000), 90_000);
    assert.equal(normalizeHoldMs(120_000), MAX_HOLD_MS);
    assert.equal(normalizeHoldMs(30), 30_000);
    assert.equal(normalizeHoldMs(0), 0);
    assert.equal(normalizeHoldMs(-1), 0);
  });
});

describe('effectiveHoldMs', () => {
  it('ignores duration when the switch is off', () => {
    assert.equal(effectiveHoldMs(false, 30_000), 0);
    assert.equal(effectiveHoldMs(true, 30_000), 30_000);
    assert.equal(effectiveHoldMs(true, 0), 30_000);
  });
});

describe('hold pulses and cooldown-after-hold', () => {
  it('spaces pulses 5–8s and never faster than 5s', () => {
    assert.equal(holdPulseIntervalMs(10_000), 5_000);
    assert.equal(holdPulseIntervalMs(30_000), 7_500);
    assert.equal(holdPulseIntervalMs(90_000), 8_000);
    assert.equal(nextHoldPulseDelayMs(30_000, 4_000), 0);
    assert.equal(nextHoldPulseDelayMs(30_000, 20_000), 7_500);
  });

  it('starts cooldown at holdUntil, not at the first open', () => {
    const openedAt = 1_000_000;
    const holdUntil = openedAt + 30_000;
    const now = holdUntil + 5_000;
    const start = cooldownStartAt(openedAt, holdUntil);
    assert.equal(start, holdUntil);
    assert.equal(cooldownRemainingMs(start, 20_000, now), 15_000);
    assert.equal(isHoldActive(holdUntil, openedAt + 10_000), true);
    assert.equal(isHoldActive(holdUntil, holdUntil + 1), false);
  });

  it('restarts hold on ENTER/EXIT/BT but not on sitting poll', () => {
    assert.equal(shouldRestartHoldFromAuto('enter'), true);
    assert.equal(shouldRestartHoldFromAuto('exit'), true);
    assert.equal(shouldRestartHoldFromAuto('bt'), true);
    assert.equal(shouldRestartHoldFromAuto('poll'), false);
    assert.equal(isSittingAutoTrigger('poll'), true);
    assert.equal(isSittingAutoTrigger('eligible_now'), true);
    assert.equal(isSittingAutoTrigger('enter'), false);
  });
});

describe('nativeRegionFromGate hold fields', () => {
  it('writes holdEnabled and capped holdMs for native pulses', () => {
    const region = nativeRegionFromGate({
      id: '4G300102168',
      deviceId: '4G300102168',
      systemId: null,
      origin: 'linked',
      sharedInviteCode: null,
      sharedFromName: null,
      name: 'Gate',
      nameOverride: null,
      enabled: true,
      lat: 32.08,
      lng: 34.78,
      radiusMeters: 50,
      cooldownMs: 20_000,
      holdEnabled: true,
      holdMs: 120_000,
      bluetooth: { required: false, devices: [] },
      lastOpenedAt: null,
      lastResult: null,
    });
    assert.equal(region.holdEnabled, true);
    assert.equal(region.holdMs, 90_000);
  });

  it('does not pulse when the switch is off', () => {
    const region = nativeRegionFromGate({
      id: 'g',
      deviceId: 'g',
      systemId: null,
      origin: 'linked',
      sharedInviteCode: null,
      sharedFromName: null,
      name: 'Gate',
      nameOverride: null,
      enabled: true,
      lat: 32,
      lng: 34,
      radiusMeters: 50,
      cooldownMs: 30_000,
      holdEnabled: false,
      holdMs: 30_000,
      bluetooth: { required: false, devices: [] },
      lastOpenedAt: null,
      lastResult: null,
    });
    assert.equal(region.holdEnabled, false);
    assert.equal(effectiveHoldMs(region.holdEnabled, region.holdMs), 0);
  });
});
