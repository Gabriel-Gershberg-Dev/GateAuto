package com.gateauto.app.keepalive;

import android.content.Context;
import android.os.Build;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Whether Auto-open may run a continuous GPS stream (location FGS / Play
 * fences / approach sampler).
 *
 * <p>Manual (auto-off) gates never demand location. If every auto-on gate
 * requires a listed car, wait until that car is connected — do not keep the
 * status-bar location pill on in the meantime. Mirrored by
 * {@code src/data/locationDemand.ts}.
 *
 * <p>Never starts a location FGS from the background. {@link #sync} only
 * starts {@link MonitoringService} when {@code allowStartLocationFgs} is true
 * (UI / Android Auto).
 */
public final class LocationDemand {
  private static final String TAG = "GateAutoKeepAlive";
  private static final AtomicBoolean syncing = new AtomicBoolean(false);
  private static final AtomicBoolean pending = new AtomicBoolean(false);
  private static final AtomicBoolean pendingAllowFgs = new AtomicBoolean(false);
  /** Last sync's GPS demand, so a car connect can poll once without a location FGS. */
  private static volatile boolean lastGpsDemand = false;

  private LocationDemand() {}

  public static boolean needsContinuousLocation(Context context) {
    if (context == null || !KeepAlivePrefs.isArmed(context)) return false;
    JSONArray arr = GeofenceRegistrar.regionsArray(context);
    boolean anyAuto = false;
    boolean anyProximity = false;
    for (int i = 0; i < arr.length(); i++) {
      JSONObject gate = arr.optJSONObject(i);
      if (gate == null || !isDemandAuto(gate)) continue;
      anyAuto = true;
      if (!requiresListedCar(gate)) {
        anyProximity = true;
        Log.i(TAG, "location demand — proximity auto gate " + gate.optString("id"));
        break;
      }
    }
    if (!anyAuto) return false;
    // Walking keeps the same stream as normal Auto-open: 30s far, 1 Hz inside
    // the detect fence. A fence wake alone is not enough on a locked phone.
    if (KeepAlivePrefs.walkingEnabled(context)) return true;
    if (anyProximity) return true;
    return listedCarConnectedForAutoGates(context);
  }

  /**
   * Play detect fences. Continuous GPS, Walking, or Motion while Auto-open is on.
   * Walking itself now demands the GPS stream. Motion without Walking still
   * only registers fences.
   */
  public static boolean needsPlayFences(Context context) {
    if (needsContinuousLocation(context)) return true;
    if (context == null || !KeepAlivePrefs.isArmed(context)) return false;
    if (!KeepAlivePrefs.walkingEnabled(context) && !KeepAlivePrefs.motionEnabled(context)) {
      return false;
    }
    JSONArray arr = GeofenceRegistrar.regionsArray(context);
    for (int i = 0; i < arr.length(); i++) {
      JSONObject gate = arr.optJSONObject(i);
      if (isDemandAuto(gate)) return true;
    }
    return false;
  }

  /**
   * A listed car for at least one auto-on, BT-required gate. UNKNOWN does not
   * count — that would keep GPS on when Bluetooth cannot be read.
   */
  public static boolean listedCarConnectedForAutoGates(Context context) {
    JSONArray arr = GeofenceRegistrar.regionsArray(context);
    for (int i = 0; i < arr.length(); i++) {
      JSONObject gate = arr.optJSONObject(i);
      if (gate == null || !isDemandAuto(gate)) continue;
      if (!requiresListedCar(gate)) continue;
      if (matchConnected(context, gate)) return true;
    }
    return false;
  }

  /** Auto-on and pin-ready — the only gates that may demand GPS. */
  static boolean isDemandAuto(JSONObject gate) {
    return GeofenceRegistrar.isAutoEnabled(gate) && hasPin(gate);
  }

  /**
   * Explicit {@code btRequired}, or older native JSON that listed a car but
   * omitted the flag. Explicit {@code false} stays proximity-only.
   */
  static boolean requiresListedCar(JSONObject gate) {
    if (gate == null) return false;
    if (gate.has("btRequired")) return gate.optBoolean("btRequired", false);
    return hasListedCar(gate);
  }

  private static boolean hasPin(JSONObject gate) {
    if (gate == null) return false;
    double lat = gate.optDouble("lat", Double.NaN);
    double lng = gate.optDouble("lng", Double.NaN);
    double radius = gate.optDouble("radius", Double.NaN);
    return Double.isFinite(lat) && Double.isFinite(lng) && radius > 0;
  }

  private static boolean hasListedCar(JSONObject gate) {
    JSONArray addrs = gate.optJSONArray("btAddresses");
    if (addrs != null) {
      for (int i = 0; i < addrs.length(); i++) {
        if (!CarBluetoothState.normalizeAddr(addrs.optString(i, "")).isEmpty()) {
          return true;
        }
      }
    }
    JSONArray names = gate.optJSONArray("btNames");
    if (names != null) {
      for (int i = 0; i < names.length(); i++) {
        if (!names.optString(i, "").trim().isEmpty()) return true;
      }
    }
    return false;
  }

  private static boolean matchConnected(Context context, JSONObject gate) {
    Set<String> wantAddr = new HashSet<>();
    JSONArray addrs = gate.optJSONArray("btAddresses");
    if (addrs != null) {
      for (int i = 0; i < addrs.length(); i++) {
        String a = CarBluetoothState.normalizeAddr(addrs.optString(i, ""));
        if (!a.isEmpty()) wantAddr.add(a);
      }
    }
    Set<String> wantName = new HashSet<>();
    JSONArray names = gate.optJSONArray("btNames");
    if (names != null) {
      for (int i = 0; i < names.length(); i++) {
        String n = names.optString(i, "").trim().toLowerCase(Locale.US);
        if (!n.isEmpty()) wantName.add(n);
      }
    }
    if (wantAddr.isEmpty() && wantName.isEmpty()) return false;
    return CarBluetoothState.match(context, wantAddr, wantName)
      == CarBluetoothState.CONNECTED;
  }

  /**
   * Xiaomi, Redmi, and POCO. Other phones keep the car-connect broadcast as
   * the only wake while every auto gate waits for a listed car.
   */
  static boolean isXiaomiFamily() {
    return oemName(Build.MANUFACTURER) || oemName(Build.BRAND);
  }

  private static boolean oemName(String raw) {
    if (raw == null) return false;
    String name = raw.toLowerCase(Locale.US);
    return name.contains("xiaomi") || name.contains("redmi") || name.contains("poco");
  }

  /**
   * Keep a non-location hold while Auto-open waits for the car. GPS stays off,
   * so the location icon stays off. The hold and the recover alarm can start
   * the process again after Xiaomi freezes it, then look at the car.
   */
  public static boolean quietHold(Context context) {
    if (context == null || !KeepAlivePrefs.isArmed(context)) return false;
    if (!isXiaomiFamily()) return false;
    if (needsContinuousLocation(context) || needsPlayFences(context)) return false;
    return hasListedCarAutoGate(context);
  }

  /** Forget the GPS-demand edge so the next arm can poll once. */
  static void onDisarmed() {
    lastGpsDemand = false;
  }

  private static boolean hasListedCarAutoGate(Context context) {
    JSONArray arr = GeofenceRegistrar.regionsArray(context);
    for (int i = 0; i < arr.length(); i++) {
      JSONObject gate = arr.optJSONObject(i);
      if (gate != null && isDemandAuto(gate) && requiresListedCar(gate)) return true;
    }
    return false;
  }

  /**
   * Arm/disarm location hardware to match demand. Play fences stay registered
   * only while GPS is allowed so the OS location indicator can drop.
   */
  public static void sync(Context context, boolean allowStartLocationFgs) {
    if (context == null) return;
    Context ctx = context.getApplicationContext();
    if (!KeepAlivePrefs.isArmed(ctx)) return;
    if (allowStartLocationFgs) pendingAllowFgs.set(true);
    pending.set(true);
    // A car disconnect that lands mid-sync must still be applied, or GPS stays
    // on with the demand that sync computed a moment earlier.
    while (pending.get() && syncing.compareAndSet(false, true)) {
      try {
        while (pending.getAndSet(false)) {
          syncLocked(ctx, pendingAllowFgs.getAndSet(false));
        }
      } finally {
        syncing.set(false);
      }
    }
  }

  private static void syncLocked(Context ctx, boolean allowStartLocationFgs) {
    boolean gps = needsContinuousLocation(ctx);
    boolean gpsRose = gps && !lastGpsDemand;
    lastGpsDemand = gps;
    boolean fences = needsPlayFences(ctx);
    Log.i(
      TAG,
      "location demand="
        + gps
        + " fences="
        + fences
        + " allowFgs="
        + allowStartLocationFgs
        + " fgs="
        + MonitoringService.isRunning()
    );
    if (gps) {
      GeofenceRegistrar.register(ctx, false);
      if (allowStartLocationFgs) {
        MonitoringService.start(ctx);
      } else {
        HoldService.ensure(ctx);
        // Car was already connected when a frozen Xiaomi process woke. The
        // connect broadcast will not fire again. Poll once, still no location FGS.
        if (gpsRose && isXiaomiFamily()) {
          KeepAliveModule.pollNearbySoon(ctx, "quiet-wake");
        }
      }
    } else if (fences) {
      // Walking, no listed car: keep the 100 m wake. No location FGS, no hold
      // notice. High GPS starts only after Play ENTER.
      GeofenceRegistrar.register(ctx, false);
      ApproachSampler.stop();
      MonitoringService.stop(ctx);
      HoldService.stop(ctx);
      MonitoringNotice.clearUnowned(ctx);
    } else {
      ApproachSampler.stop();
      MonitoringService.stop(ctx);
      GeofenceRegistrar.unregister(ctx);
      if (quietHold(ctx) && !MonitoringService.isRunning()) {
        // Xiaomi freezes a process that has nothing holding it. Stay up with
        // no GPS until the listed car connects. Never while the location
        // service is already running — stopping that service from the
        // background means it cannot come back until the app is opened.
        HoldService.ensureQuiet(ctx);
        Log.i(TAG, "quiet hold — waiting for listed car, no GPS");
      } else {
        // The car-connect broadcast cold-starts the process. A hold here only
        // kept a running notice up.
        HoldService.stop(ctx);
        MonitoringNotice.clearUnowned(ctx);
      }
    }
    WalkActivity.sync(ctx);
  }
}
