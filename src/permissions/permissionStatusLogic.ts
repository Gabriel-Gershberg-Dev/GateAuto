/**
 * Pure Auto-open OS status rules (Permissions UI, setup sheet, Gates banner).
 * Runtime values come from KeepAlive native; this file is the documented policy.
 */

export type BluetoothStatusInput = {
  /** Build.VERSION.SDK_INT, or a JS fallback that may be an OS version (12–19). */
  sdkInt: number;
  connectGranted: boolean;
  /** Adapter on/off — never treated as the Nearby-devices permission. */
  adapterEnabled?: boolean;
};

export type BatteryStatusInput = {
  /** AOSP Doze allowlist — Settings → Apps → Special access → Optimize battery. */
  ignoringBatteryOptimizations: boolean;
  /** Restricted battery / “Don’t allow background”. */
  backgroundRestricted: boolean;
  /** AppOps android:system_exempt_from_power_restrictions (API 34+). */
  powerRestrictionExempt: boolean;
  /** Samsung Device Care “never sleeping” list, when readable. */
  samsungNeverSleeping: boolean;
  /** UsageStats STANDBY_BUCKET_EXEMPTED (5). */
  standbyExempt: boolean;
};

/**
 * Android 12+ needs BLUETOOTH_CONNECT. Pre-12 install-time BT is enough.
 * JS Platform.Version is sometimes the OS version (15/16), not API 31+.
 */
export function needsRuntimeBluetoothPermission(sdkInt: number): boolean {
  if (!Number.isFinite(sdkInt) || sdkInt <= 0) return true;
  if (sdkInt >= 31) return true;
  // API 12–19 do not exist on phones that run this app; treat as OS version.
  if (sdkInt >= 12 && sdkInt <= 19) return true;
  return false;
}

/** Nearby-devices / CONNECT grant. Ignores adapter isEnabled. */
export function bluetoothPermissionGranted(input: BluetoothStatusInput): boolean {
  if (!needsRuntimeBluetoothPermission(input.sdkInt)) return true;
  return input.connectGranted === true;
}

/**
 * Apps → GateAuto → Battery → Unrestricted (and Samsung never-sleep).
 * Not the same as only REQUEST_IGNORE_BATTERY_OPTIMIZATIONS on One UI.
 */
export function batteryUnrestrictedGranted(input: BatteryStatusInput): boolean {
  if (input.backgroundRestricted) return false;
  return (
    input.ignoringBatteryOptimizations ||
    input.powerRestrictionExempt ||
    input.samsungNeverSleeping ||
    input.standbyExempt
  );
}
