import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveStreetViewPin } from '../src/ui/streetViewPin';

describe('resolveStreetViewPin', () => {
  it('uses the panorama when both coords are finite', () => {
    assert.deepEqual(resolveStreetViewPin(32.08, 34.78, 32.0, 34.0), {
      lat: 32.08,
      lng: 34.78,
      source: 'pano',
    });
  });

  it('falls back when the camera never reported a position', () => {
    assert.deepEqual(resolveStreetViewPin(null, null, 32.0853, 34.7818), {
      lat: 32.0853,
      lng: 34.7818,
      source: 'fallback',
    });
  });

  it('falls back when only one panorama coord arrived', () => {
    assert.deepEqual(resolveStreetViewPin(32.08, null, 1, 2), {
      lat: 1,
      lng: 2,
      source: 'fallback',
    });
  });

  it('falls back on non-finite panorama coords', () => {
    assert.deepEqual(resolveStreetViewPin(Number.NaN, 34.78, 1, 2), {
      lat: 1,
      lng: 2,
      source: 'fallback',
    });
  });
});
