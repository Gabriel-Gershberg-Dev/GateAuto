import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { scannedSystemLabel } from '../src/data/systemLabel';

describe('scannedSystemLabel', () => {
  it('names a new scan after the signed-in user', () => {
    assert.equal(
      scannedSystemLabel({ userName: 'Gabriel', phoneNumber: 972501234567, index: 1 }),
      'Gabriel PalGate',
    );
  });

  it('does not append PalGate twice', () => {
    assert.equal(
      scannedSystemLabel({
        userName: 'Gabriel PalGate',
        phoneNumber: 972501234567,
        index: 1,
      }),
      'Gabriel PalGate',
    );
  });

  it('keeps a second scanned system distinct with the phone tail', () => {
    assert.equal(
      scannedSystemLabel({ userName: 'Gabriel', phoneNumber: 972501234567, index: 2 }),
      'Gabriel PalGate · 4567',
    );
  });

  it('keeps the old default when there is no real name', () => {
    assert.equal(
      scannedSystemLabel({ userName: 'Guest', phoneNumber: 972501234567, index: 1 }),
      'Your PalGate · 4567',
    );
    assert.equal(
      scannedSystemLabel({ userName: '  ', phoneNumber: 972501234567, index: 1 }),
      'Your PalGate · 4567',
    );
    assert.equal(
      scannedSystemLabel({ userName: null, phoneNumber: 0, index: 1 }),
      'Your PalGate',
    );
  });
});

describe('existing PalGate names', () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), 'src', 'data', 'palgateSystems.ts'),
    'utf8',
  );

  it('keeps a stored name when the same PalGate is scanned again', () => {
    assert.match(src, /label: options\?\.label\?\.trim\(\) \|\| row\.label/);
  });

  it('does not rename a legacy system that was already on the phone', () => {
    const migrate = src.slice(
      src.indexOf('async function migrateLegacyIfNeeded'),
      src.indexOf('export async function listSystems'),
    );
    assert.match(migrate, /labelForCredentials\(legacy, 'linked', 1\)/);
    assert.equal(migrate.includes('scannedSystemLabel'), false);
  });
});
