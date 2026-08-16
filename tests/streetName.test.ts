import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatCoordPair, formatStreetName } from '../src/ui/streetName';

describe('formatStreetName', () => {
  it('joins street number, street, and city', () => {
    assert.equal(
      formatStreetName({
        streetNumber: '12',
        street: 'Herzl',
        city: 'Tel Aviv',
      }),
      '12 Herzl · Tel Aviv',
    );
  });

  it('falls back to the first two formatted parts', () => {
    assert.equal(
      formatStreetName({
        formattedAddress: 'Herzl Street, Tel Aviv-Yafo, Israel',
      }),
      'Herzl Street · Tel Aviv-Yafo',
    );
  });

  it('returns empty when nothing useful is present', () => {
    assert.equal(formatStreetName({}), '');
  });
});

describe('formatCoordPair', () => {
  it('prints six decimal places', () => {
    assert.equal(formatCoordPair(32.0853, 34.7818), '32.085300, 34.781800');
  });
});
