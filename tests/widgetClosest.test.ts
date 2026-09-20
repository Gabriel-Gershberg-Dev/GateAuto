import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isPinnedCoord,
  isWidgetEligible,
  pickOpenGateId,
  rankPinnedGates,
  type WidgetPin,
} from '../src/data/widgetClosest';

function pin(partial: Partial<WidgetPin> & { id: string }): WidgetPin {
  return {
    lat: 32.08,
    lng: 34.78,
    deviceId: `dev-${partial.id}`,
    lastOpenedAt: 0,
    ...partial,
  };
}

describe('widgetClosest contract', () => {
  it('treats finite lat/lng as a pin and ignores Auto flags', () => {
    assert.equal(isPinnedCoord(32.1, 34.8), true);
    assert.equal(isPinnedCoord(Number.NaN, 34.8), false);
    assert.equal(
      isWidgetEligible({
        id: 'a',
        lat: 32.1,
        lng: 34.8,
        deviceId: 'd1',
        hasCredentials: true,
        enabled: false,
      }),
      true,
    );
    assert.equal(
      isWidgetEligible({
        id: 'a',
        lat: 32.1,
        lng: 34.8,
        deviceId: '',
        hasCredentials: true,
      }),
      false,
    );
    assert.equal(
      isWidgetEligible({
        id: 'a',
        lat: 32.1,
        lng: 34.8,
        deviceId: 'd1',
        hasCredentials: false,
      }),
      false,
    );
  });

  it('ranks by distance when a fix exists, not by last-open', () => {
    const ranked = rankPinnedGates(
      [
        pin({ id: 'far', lat: 32.2, lng: 34.8, lastOpenedAt: 9 }),
        pin({ id: 'near', lat: 32.081, lng: 34.781, lastOpenedAt: 1 }),
      ],
      { lat: 32.08, lng: 34.78 },
      null,
    );
    assert.equal(ranked[0]?.id, 'near');
    assert.ok(ranked[0]?.meters != null && ranked[0].meters < (ranked[1]?.meters ?? 0));
  });

  it('without a fix uses last ranked closest, else most recently opened', () => {
    const pins = [
      pin({ id: 'old', lastOpenedAt: 10 }),
      pin({ id: 'fresh', lastOpenedAt: 99 }),
    ];
    assert.equal(rankPinnedGates(pins, null, null)[0]?.id, 'fresh');
    assert.equal(rankPinnedGates(pins, null, 'old')[0]?.id, 'old');
    assert.equal(rankPinnedGates(pins, null, 'old')[0]?.meters, null);
  });

  it('opens a requested id when it is ranked, else the closest', () => {
    const ranked = [
      { id: 'home', meters: 12 },
      { id: 'work', meters: 200 },
    ];
    assert.equal(pickOpenGateId(ranked, 'work'), 'work');
    assert.equal(pickOpenGateId(ranked, 'missing'), 'home');
    assert.equal(pickOpenGateId([], null), null);
  });
});
