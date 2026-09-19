import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  batteryUnrestrictedGranted,
  bluetoothPermissionGranted,
  needsRuntimeBluetoothPermission,
} from '../src/permissions/permissionStatusLogic';

describe('bluetooth permission status', () => {
  it('does not treat adapter-on as Nearby devices granted', () => {
    assert.equal(
      bluetoothPermissionGranted({
        sdkInt: 35,
        connectGranted: false,
        adapterEnabled: true,
      }),
      false,
    );
    assert.equal(
      bluetoothPermissionGranted({
        sdkInt: 35,
        connectGranted: true,
        adapterEnabled: false,
      }),
      true,
    );
  });

  it('requires CONNECT on API 31+ and on OS-version-shaped 12–19 values', () => {
    assert.equal(needsRuntimeBluetoothPermission(35), true);
    assert.equal(needsRuntimeBluetoothPermission(15), true);
    assert.equal(needsRuntimeBluetoothPermission(16), true);
    assert.equal(needsRuntimeBluetoothPermission(30), false);
    assert.equal(
      bluetoothPermissionGranted({ sdkInt: 30, connectGranted: false }),
      true,
    );
    assert.equal(
      bluetoothPermissionGranted({ sdkInt: 15, connectGranted: false }),
      false,
    );
  });
});

describe('Unrestricted battery status', () => {
  const off = {
    ignoringBatteryOptimizations: false,
    backgroundRestricted: false,
    powerRestrictionExempt: false,
    samsungNeverSleeping: false,
    standbyExempt: false,
  };

  it('is not granted when only Optimized (not Restricted, not allowlisted)', () => {
    assert.equal(batteryUnrestrictedGranted(off), false);
  });

  it('is granted for AOSP ignore-optimizations or Samsung/API equivalents', () => {
    assert.equal(
      batteryUnrestrictedGranted({ ...off, ignoringBatteryOptimizations: true }),
      true,
    );
    assert.equal(
      batteryUnrestrictedGranted({ ...off, powerRestrictionExempt: true }),
      true,
    );
    assert.equal(
      batteryUnrestrictedGranted({ ...off, samsungNeverSleeping: true }),
      true,
    );
    assert.equal(
      batteryUnrestrictedGranted({ ...off, standbyExempt: true }),
      true,
    );
  });

  it('treats Restricted as not Unrestricted even if another flag is set', () => {
    assert.equal(
      batteryUnrestrictedGranted({
        ...off,
        ignoringBatteryOptimizations: true,
        backgroundRestricted: true,
      }),
      false,
    );
  });
});
