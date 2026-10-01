package com.gateauto.app.keepalive;

import android.content.Context;
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
    if (anyProximity) return true;
    return listedCarConnectedForAutoGates(context);
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
    boolean need = needsContinuousLocation(ctx);
    Log.i(
      TAG,
      "location demand="
        + need
        + " allowFgs="
        + allowStartLocationFgs
        + " fgs="
        + MonitoringService.isRunning()
    );
    if (need) {
      GeofenceRegistrar.register(ctx, false);
      if (allowStartLocationFgs) {
        MonitoringService.start(ctx);
      } else {
        HoldService.ensure(ctx);
      }
    } else {
      ApproachSampler.stop();
      MonitoringService.stop(ctx);
      GeofenceRegistrar.unregister(ctx);
      // Nothing to hold for: the car-connect broadcast cold-starts the process
      // and re-arms. Keeping the hold only kept a "running" notice up.
      HoldService.stop(ctx);
      MonitoringNotice.clearUnowned(ctx);
    }
  }
}
