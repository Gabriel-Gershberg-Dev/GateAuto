import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { gateCardMarks } from '../src/data/gateCardFacts';
import { canShareGate } from '../src/share/inviteLogic';

describe('gate card marks', () => {
  it('surfaces BT, hold, share, and a hidden PalGate name', () => {
    const marks = gateCardMarks({
      origin: 'shared',
      name: 'חניון',
      nameOverride: 'החנית 1',
      bluetooth: { required: true },
      holdEnabled: true,
      radiusMeters: 25,
      lat: 32.1,
      lng: 34.8,
    });
    assert.equal(marks.shared, true);
    assert.equal(marks.bluetooth, true);
    assert.equal(marks.hold, true);
    assert.equal(marks.hasPin, true);
    assert.equal(marks.meters, 25);
    assert.equal(marks.hiddenPalGateName, 'חניון');
  });

  it('does not invent a second PalGate name when they match', () => {
    const marks = gateCardMarks({
      origin: 'linked',
      name: 'החנית 1',
      nameOverride: 'החנית 1',
      bluetooth: { required: false },
      holdEnabled: false,
      radiusMeters: 50,
    });
    assert.equal(marks.shared, false);
    assert.equal(marks.hiddenPalGateName, null);
    assert.equal(canShareGate({ origin: 'linked' }), true);
    assert.equal(canShareGate({ origin: 'shared' }), false);
  });
});
