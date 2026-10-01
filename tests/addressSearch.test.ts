import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { addressSuggestions, placeSuggestions } from '../src/ui/addressSearch';

describe('placeSuggestions', () => {
  it('lists every autocomplete row with its city and no country', () => {
    const rows = placeSuggestions([
      { placeId: 'a', title: 'דרך ירושלים 2', subtitle: 'רמת גן, ישראל' },
      { placeId: 'b', title: 'דרך ירושלים 2', subtitle: 'תל אביב-יפו, ישראל' },
      { placeId: 'c', title: 'דרך ירושלים', subtitle: 'ירושלים, Israel' },
    ]);
    assert.deepEqual(
      rows.map((row) => [row.placeId, row.title, row.subtitle]),
      [
        ['a', 'דרך ירושלים 2', 'רמת גן'],
        ['b', 'דרך ירושלים 2', 'תל אביב-יפו'],
        ['c', 'דרך ירושלים', 'ירושלים'],
      ],
    );
    assert.equal(rows[0].latitude, undefined);
  });

  it('folds duplicates and skips rows without an id or title', () => {
    const rows = placeSuggestions([
      { placeId: 'a', title: 'הרצל 1', subtitle: 'ראשון לציון' },
      { placeId: 'a2', title: 'הרצל 1', subtitle: 'ראשון לציון, ישראל' },
      { placeId: '', title: 'nothing' },
      { placeId: 'x', title: '  ' },
    ]);
    assert.equal(rows.length, 1);
  });
});

describe('Places autocomplete native', () => {
  const javaDir = path.join(process.cwd(), 'src', 'platform', 'android-keepalive');
  const places = fs.readFileSync(path.join(javaDir, 'PlacesSearch.java'), 'utf8');

  it('sends the Android key restriction headers and one billing session', () => {
    assert.ok(places.includes('"X-Android-Package"'));
    assert.ok(places.includes('"X-Android-Cert"'));
    assert.ok(places.includes('"sessionToken"'));
    assert.ok(places.includes('"location,formattedAddress"'));
  });

  it('is copied into the Android project', () => {
    const plugin = fs.readFileSync(
      path.join(process.cwd(), 'src', 'platform', 'withAndroidKeepAlive.js'),
      'utf8',
    );
    assert.ok(plugin.includes("'PlacesSearch.java'"));
  });
});

describe('addressSuggestions', () => {
  it('keeps the same street in two cities as two choices', () => {
    const rows = addressSuggestions([
      {
        latitude: 32.07,
        longitude: 34.78,
        street: 'דרך ירושלים',
        streetNumber: '2',
        city: 'תל אביב-יפו',
      },
      {
        latitude: 32.08,
        longitude: 34.81,
        street: 'דרך ירושלים',
        streetNumber: '2',
        city: 'רמת גן',
      },
    ]);
    assert.deepEqual(
      rows.map((row) => [row.title, row.subtitle]),
      [
        ['2 דרך ירושלים', 'תל אביב-יפו'],
        ['2 דרך ירושלים', 'רמת גן'],
      ],
    );
  });

  it('reads the city from a formatted line and drops the country', () => {
    const rows = addressSuggestions([
      {
        latitude: 32.08,
        longitude: 34.81,
        formattedAddress: 'דרך ירושלים 2, רמת גן, ישראל',
      },
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, 'דרך ירושלים 2');
    assert.equal(rows[0].subtitle, 'רמת גן');
  });

  it('collapses a repeated place and skips a hit with no label', () => {
    const rows = addressSuggestions([
      {
        latitude: 32.08,
        longitude: 34.81,
        formattedAddress: 'דרך ירושלים 2, רמת גן, Israel',
      },
      {
        latitude: 32.0801,
        longitude: 34.8101,
        formattedAddress: 'דרך ירושלים 2, רמת גן, ישראל',
      },
      { latitude: 0, longitude: 0 },
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].subtitle, 'רמת גן');
  });
});

describe('address search native', () => {
  it('asks the geocoder for several hits and prefers Israel before the world', () => {
    const src = fs.readFileSync(
      path.join(
        process.cwd(),
        'src',
        'platform',
        'android-keepalive',
        'KeepAliveModule.java',
      ),
      'utf8',
    );
    const body = src.slice(src.indexOf('void searchAddresses'));
    assert.ok(body.includes('ADDRESS_LIMIT, IL_SOUTH, IL_WEST, IL_NORTH, IL_EAST'));
    const worldwide = body.indexOf('getFromLocationName(q, ADDRESS_LIMIT)');
    assert.ok(worldwide > body.indexOf('IL_EAST'));
    assert.ok(body.includes('getLocality()'));
    assert.ok(body.includes('getAddressLine(0)'));
  });
});
