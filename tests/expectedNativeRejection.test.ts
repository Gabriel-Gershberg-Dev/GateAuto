import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isExpectedPrePermissionNativeError } from '../src/geo/expectedNativeRejection';

describe('isExpectedPrePermissionNativeError', () => {
  it('hides ExpoLocation.hasStartedGeofencingAsync before Always location', () => {
    const message =
      "Call to function 'ExpoLocation.hasStartedGeofencingAsync' has been rejected.\n→ Caused by: Not authorized to use background location services";
    assert.equal(isExpectedPrePermissionNativeError(new Error(message)), true);
    assert.equal(isExpectedPrePermissionNativeError(message), true);
  });

  it('hides similar hasStarted / Expo Location rejections', () => {
    assert.equal(
      isExpectedPrePermissionNativeError(
        new Error(
          "Call to function 'ExpoLocation.hasStartedLocationUpdatesAsync' has been rejected.",
        ),
      ),
      true,
    );
    assert.equal(
      isExpectedPrePermissionNativeError(
        new Error('Not authorized to use location services'),
      ),
      true,
    );
  });

  it('still treats PalGate / network / open failures as user-facing', () => {
    assert.equal(
      isExpectedPrePermissionNativeError(new Error('Network request failed')),
      false,
    );
    assert.equal(
      isExpectedPrePermissionNativeError(
        new Error('PalGate open failed: HTTP 500'),
      ),
      false,
    );
    assert.equal(
      isExpectedPrePermissionNativeError(
        new Error('Could not reach palgate.example'),
      ),
      false,
    );
    assert.equal(isExpectedPrePermissionNativeError(null), false);
  });
});
