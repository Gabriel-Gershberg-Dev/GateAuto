/**
 * Analytics + Crashlytics from native auto-open (JS may be dead while locked).
 * Never logs PalGate tokens, pins, emails, raw GPS, or deviceId.
 */
package com.gateauto.app.keepalive;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;

import com.google.firebase.analytics.FirebaseAnalytics;
import com.google.firebase.crashlytics.FirebaseCrashlytics;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public final class GateAutoTelemetry {
  private static final String TAG = "GateAutoTelemetry";
  private static final long TICK_MIN_MS = 60_000L;
  private static final long POLL_SKIP_MIN_MS = 60_000L;
  private static volatile long lastTickAt;
  private static final Map<String, Long> skipAt = new ConcurrentHashMap<>();

  private GateAutoTelemetry() {}

  static String hashGateId(String raw) {
    if (raw == null) return "g_unknown";
    String s = raw.trim();
    if (s.isEmpty()) return "g_unknown";
    int h = 0x811c9dc5;
    for (int i = 0; i < s.length(); i++) {
      h ^= s.charAt(i);
      h *= 16777619;
    }
    return String.format(Locale.US, "g_%08x", h);
  }

  static void breadcrumb(String message) {
    if (message == null || message.isEmpty()) return;
    try {
      String cut = message.length() > 120 ? message.substring(0, 120) : message;
      FirebaseCrashlytics.getInstance().log(cut);
    } catch (Throwable ignored) {
      // Firebase must never break auto-open.
    }
  }

  static void autoOpen(
    Context context,
    String source,
    String gateId,
    Double distanceM,
    JSONObject gate
  ) {
    autoOpen(context, source, gateId, distanceM, gate, -1L, null);
  }

  /**
   * @param latencyMs broadcast-receipt → open-done (native cold path), or ≤0
   *     when unmeasured. Lets us see the cold-wake 10–15s in Analytics.
   * @param warm 1 if a location FGS was alive when the trigger fired, 0 if the
   *     process was cold. null → derive from the current FGS state.
   */
  static void autoOpen(
    Context context,
    String source,
    String gateId,
    Double distanceM,
    JSONObject gate,
    long latencyMs,
    Boolean warm
  ) {
    refreshKeys(context);
    Bundle params = baseGateParams(gateId, distanceM, gate);
    putString(params, "source", source);
    boolean warmFlag = warm != null ? warm : PalGateNativeOpen.locationFgsRunning(context);
    params.putInt("warm", warmFlag ? 1 : 0);
    if (latencyMs >= 0) {
      params.putInt("latency_ms", (int) Math.min(latencyMs, 600_000L));
    }
    long procAge = processAgeMs();
    if (procAge >= 0) {
      params.putInt("proc_age_ms", (int) Math.min(procAge, 600_000L));
    }
    logEvent(context, "auto_open", params);
    breadcrumb(
      "open "
        + nz(source)
        + " "
        + hashGateId(gateId)
        + " "
        + (distanceM != null && Double.isFinite(distanceM)
          ? String.format(Locale.US, "%.0fm", distanceM)
          : "?m")
        + (warmFlag ? " warm" : " cold")
        + (latencyMs >= 0 ? " " + latencyMs + "ms" : "")
    );
  }

  /** Process age = whole cold-start cost when the fence woke us from dead. */
  private static long processAgeMs() {
    try {
      if (Build.VERSION.SDK_INT >= 24) {
        return android.os.SystemClock.elapsedRealtime()
          - android.os.Process.getStartElapsedRealtime();
      }
    } catch (Throwable ignored) {
      // ignore
    }
    return -1L;
  }

  static void autoSkip(
    Context context,
    String reason,
    String source,
    String gateId,
    Double distanceM,
    JSONObject gate
  ) {
    if (shouldThrottleSkip(reason, source, gateId)) return;
    Bundle params = baseGateParams(gateId, distanceM, gate);
    putString(params, "reason", reason);
    putString(params, "source", source);
    logEvent(context, "auto_skip", params);
    breadcrumb("skip " + nz(reason) + " " + nz(source) + " " + hashGateId(gateId));
  }

  static void keepaliveTick(Context context, String result) {
    if (result == null) return;
    boolean interesting = "hung_killed".equals(result);
    long now = System.currentTimeMillis();
    if (!interesting) {
      if (lastTickAt > 0 && now - lastTickAt < TICK_MIN_MS) return;
      lastTickAt = now;
    }
    Bundle params = new Bundle();
    params.putString("result", result);
    logEvent(context, "keepalive_tick", params);
    if (interesting) breadcrumb("keepalive hung_killed");
  }

  static void permissionState(Context context) {
    try {
      Bundle params = new Bundle();
      params.putInt("always_loc", alwaysLocation(context) ? 1 : 0);
      params.putInt("notifications", notificationsGranted(context) ? 1 : 0);
      params.putInt(
        "bt_connect",
        AutoOpenPermissionStatus.bluetoothConnectGranted(context) ? 1 : 0
      );
      params.putInt(
        "battery_unrestricted",
        AutoOpenPermissionStatus.isBatteryUnrestricted(context) ? 1 : 0
      );
      logEvent(context, "permission_state", params);
    } catch (Throwable ignored) {
      // ignore
    }
  }

  static void refreshKeys(Context context) {
    if (context == null) return;
    try {
      FirebaseCrashlytics crash = FirebaseCrashlytics.getInstance();
      String version = "unknown";
      try {
        version =
          context
            .getPackageManager()
            .getPackageInfo(context.getPackageName(), 0)
            .versionName;
        if (version == null || version.isEmpty()) version = "unknown";
      } catch (Exception ignored) {
        // keep unknown
      }
      crash.setCustomKey("version", version);
      crash.setCustomKey("auto_on", KeepAlivePrefs.isArmed(context) ? 1 : 0);
      crash.setCustomKey("fence_count", autoFenceCount(context));
      crash.setCustomKey("always_location", alwaysLocation(context) ? 1 : 0);
    } catch (Throwable ignored) {
      // ignore
    }
  }

  static void recordUnexpected(Throwable error) {
    if (error == null) return;
    try {
      FirebaseCrashlytics.getInstance().recordException(error);
    } catch (Throwable ignored) {
      // ignore
    }
  }

  private static boolean shouldThrottleSkip(
    String reason,
    String source,
    String gateId
  ) {
    if (!"poll".equals(source) && !"recover".equals(source)) return false;
    if (
      !"cooldown".equals(reason)
        && !"outside_radius".equals(reason)
        && !"other".equals(reason)
    ) {
      return false;
    }
    String key = nz(reason) + ":" + nz(source) + ":" + nz(gateId);
    long now = System.currentTimeMillis();
    Long last = skipAt.get(key);
    if (last != null && now - last < POLL_SKIP_MIN_MS) return true;
    skipAt.put(key, now);
    return false;
  }

  private static Bundle baseGateParams(
    String gateId,
    Double distanceM,
    JSONObject gate
  ) {
    Bundle params = new Bundle();
    putString(params, "gate_hash", hashGateId(gateId));
    if (distanceM != null && Double.isFinite(distanceM)) {
      params.putInt("distance_m", (int) Math.round(Math.max(0, distanceM)));
    }
    if (gate != null) {
      double radius = gate.optDouble("radius", Double.NaN);
      if (radius > 0 && Double.isFinite(radius)) {
        params.putInt("radius_m", (int) Math.round(Math.min(250, radius)));
      }
      params.putInt("bt_required", gate.optBoolean("btRequired", false) ? 1 : 0);
    }
    return params;
  }

  private static void logEvent(Context context, String name, Bundle params) {
    if (context == null || name == null) return;
    try {
      FirebaseAnalytics.getInstance(context.getApplicationContext())
        .logEvent(name, params);
    } catch (Throwable e) {
      Log.w(TAG, "analytics " + name + " failed", e);
    }
  }

  private static void putString(Bundle params, String key, String value) {
    if (value == null || value.isEmpty()) return;
    params.putString(key, value);
  }

  private static String nz(String value) {
    return value == null ? "" : value;
  }

  private static int autoFenceCount(Context context) {
    JSONArray arr = GeofenceRegistrar.regionsArray(context);
    if (arr == null) return 0;
    int n = 0;
    for (int i = 0; i < arr.length(); i++) {
      JSONObject gate = arr.optJSONObject(i);
      if (gate != null && GeofenceRegistrar.isAutoEnabled(gate)) n++;
    }
    return n;
  }

  static boolean alwaysLocation(Context context) {
    if (Build.VERSION.SDK_INT >= 29) {
      return context.checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        == PackageManager.PERMISSION_GRANTED;
    }
    return context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)
        == PackageManager.PERMISSION_GRANTED
      || context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)
        == PackageManager.PERMISSION_GRANTED;
  }

  static boolean notificationsGranted(Context context) {
    if (Build.VERSION.SDK_INT < 33) return true;
    return context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
      == PackageManager.PERMISSION_GRANTED;
  }
}
