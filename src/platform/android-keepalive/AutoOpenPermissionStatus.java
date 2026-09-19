package com.gateauto.app.keepalive;

import android.Manifest;
import android.app.ActivityManager;
import android.app.AppOpsManager;
import android.app.usage.UsageStatsManager;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.PowerManager;
import android.os.Process;
import android.provider.Settings;
import android.util.Log;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.WritableMap;

/**
 * OS flags for the Permissions UI / setup sheet / Gates banner.
 * Samsung Apps → Battery → Unrestricted is not always the Doze allowlist.
 */
final class AutoOpenPermissionStatus {
  private static final String TAG = "GateAutoKeepAlive";
  /** {@link UsageStatsManager} STANDBY_BUCKET_EXEMPTED (hidden). */
  private static final int STANDBY_BUCKET_EXEMPTED = 5;
  private static final String OP_POWER_EXEMPT =
    "android:system_exempt_from_power_restrictions";

  private static final String[] NEVER_SLEEP_KEYS = {
    "never_sleeping_apps",
    "never_sleeping_packages",
    "sm_never_sleeping_apps",
    "app_sleep_disabled_list",
  };

  private AutoOpenPermissionStatus() {}

  static boolean isIgnoringBatteryOptimizations(Context ctx) {
    PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
    return pm != null && pm.isIgnoringBatteryOptimizations(ctx.getPackageName());
  }

  static boolean isBackgroundRestricted(Context ctx) {
    if (Build.VERSION.SDK_INT < 28) return false;
    ActivityManager am = (ActivityManager) ctx.getSystemService(Context.ACTIVITY_SERVICE);
    return am != null && am.isBackgroundRestricted();
  }

  static boolean isPowerRestrictionExempt(Context ctx) {
    if (Build.VERSION.SDK_INT < 34) return false;
    try {
      AppOpsManager appOps = (AppOpsManager) ctx.getSystemService(Context.APP_OPS_SERVICE);
      if (appOps == null) return false;
      int mode =
        appOps.checkOpNoThrow(OP_POWER_EXEMPT, Process.myUid(), ctx.getPackageName());
      return mode == AppOpsManager.MODE_ALLOWED;
    } catch (Exception e) {
      return false;
    }
  }

  static boolean isStandbyExempt(Context ctx) {
    if (Build.VERSION.SDK_INT < 28) return false;
    try {
      UsageStatsManager usm =
        (UsageStatsManager) ctx.getSystemService(Context.USAGE_STATS_SERVICE);
      return usm != null && usm.getAppStandbyBucket() == STANDBY_BUCKET_EXEMPTED;
    } catch (Exception e) {
      return false;
    }
  }

  static boolean isSamsungNeverSleeping(Context ctx) {
    String pkg = ctx.getPackageName();
    for (String key : NEVER_SLEEP_KEYS) {
      if (csvContainsPackage(Settings.Global.getString(ctx.getContentResolver(), key), pkg)) {
        return true;
      }
      if (csvContainsPackage(Settings.Secure.getString(ctx.getContentResolver(), key), pkg)) {
        return true;
      }
      if (csvContainsPackage(Settings.System.getString(ctx.getContentResolver(), key), pkg)) {
        return true;
      }
    }
    return false;
  }

  /**
   * True when Apps → GateAuto → Battery is Unrestricted (or an equivalent
   * Samsung never-sleep / power-restriction exemption). Restricted wins.
   */
  static boolean isBatteryUnrestricted(Context ctx) {
    if (isBackgroundRestricted(ctx)) return false;
    return isIgnoringBatteryOptimizations(ctx)
      || isPowerRestrictionExempt(ctx)
      || isSamsungNeverSleeping(ctx)
      || isStandbyExempt(ctx);
  }

  static boolean bluetoothConnectGranted(Context ctx) {
    if (Build.VERSION.SDK_INT < 31) return true;
    return ctx.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT)
      == PackageManager.PERMISSION_GRANTED;
  }

  static boolean bluetoothScanGranted(Context ctx) {
    if (Build.VERSION.SDK_INT < 31) return true;
    return ctx.checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN)
      == PackageManager.PERMISSION_GRANTED;
  }

  static boolean bluetoothAdapterEnabled(Context ctx) {
    try {
      BluetoothManager mgr =
        (BluetoothManager) ctx.getSystemService(Context.BLUETOOTH_SERVICE);
      BluetoothAdapter adapter = mgr != null ? mgr.getAdapter() : BluetoothAdapter.getDefaultAdapter();
      return adapter != null && adapter.isEnabled();
    } catch (SecurityException e) {
      return false;
    } catch (Exception e) {
      return false;
    }
  }

  static WritableMap snapshot(Context ctx) {
    boolean ignoring = isIgnoringBatteryOptimizations(ctx);
    boolean restricted = isBackgroundRestricted(ctx);
    boolean powerExempt = isPowerRestrictionExempt(ctx);
    boolean neverSleep = isSamsungNeverSleeping(ctx);
    boolean standbyExempt = isStandbyExempt(ctx);
    boolean unrestricted =
      !restricted && (ignoring || powerExempt || neverSleep || standbyExempt);
    boolean connect = bluetoothConnectGranted(ctx);
    boolean scan = bluetoothScanGranted(ctx);
    boolean adapter = bluetoothAdapterEnabled(ctx);

    Log.i(
      TAG,
      "perm status unrestricted="
        + unrestricted
        + " ignoreOpt="
        + ignoring
        + " bgRestricted="
        + restricted
        + " powerExempt="
        + powerExempt
        + " neverSleep="
        + neverSleep
        + " standbyExempt="
        + standbyExempt
        + " btConnect="
        + connect
        + " btScan="
        + scan
        + " btOn="
        + adapter
        + " sdk="
        + Build.VERSION.SDK_INT
    );

    WritableMap map = Arguments.createMap();
    map.putInt("sdkInt", Build.VERSION.SDK_INT);
    map.putBoolean("batteryUnrestricted", unrestricted);
    map.putBoolean("ignoringBatteryOptimizations", ignoring);
    map.putBoolean("backgroundRestricted", restricted);
    map.putBoolean("powerRestrictionExempt", powerExempt);
    map.putBoolean("samsungNeverSleeping", neverSleep);
    map.putBoolean("standbyExempt", standbyExempt);
    map.putBoolean("bluetoothConnectGranted", connect);
    map.putBoolean("bluetoothScanGranted", scan);
    map.putBoolean("bluetoothAdapterEnabled", adapter);
    return map;
  }

  private static boolean csvContainsPackage(String raw, String pkg) {
    if (raw == null || raw.isEmpty() || pkg == null || pkg.isEmpty()) return false;
    String needle = pkg.toLowerCase();
    for (String part : raw.split("[,;|]")) {
      if (part.trim().toLowerCase().equals(needle)) return true;
    }
    return false;
  }
}
