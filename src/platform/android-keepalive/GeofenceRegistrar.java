package com.gateauto.app.keepalive;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.SystemClock;
import android.util.Log;

import com.google.android.gms.location.Geofence;
import com.google.android.gms.location.GeofencingClient;
import com.google.android.gms.location.GeofencingRequest;
import com.google.android.gms.location.LocationServices;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

/**
 * Play Services geofences owned by GateAuto — not Expo TaskManager/JobScheduler.
 * JobScheduler is what Samsung delays for hours while the screen is locked.
 */
public final class GeofenceRegistrar {
  private static final String TAG = "GateAutoKeepAlive";
  private static final String PREF = "gateauto_keepalive";
  private static final String KEY_REGIONS = "regionsJson";
  /** Enabled fence geometry last given to Play (id|lat|lng|radius). */
  private static final String KEY_FENCE_SIG = "registeredFenceSig";
  /** elapsedRealtime when that signature was written — detects reboot. */
  private static final String KEY_FENCE_ELAPSED = "registeredFenceElapsed";
  private static final int PI_REQ = 71011;

  private GeofenceRegistrar() {}

  public static void saveRegionsJson(Context context, String json) {
    String value = json == null ? "[]" : json;
    prefs(context).edit().putString(KEY_REGIONS, value).apply();
    int n = 0;
    int auto = 0;
    try {
      JSONArray arr = new JSONArray(value);
      n = arr.length();
      for (int i = 0; i < arr.length(); i++) {
        if (isAutoEnabled(arr.optJSONObject(i))) auto++;
      }
    } catch (Exception ignored) {
      // ignore
    }
    Log.i(TAG, "native regions saved: " + n + " gate(s), " + auto + " auto-open");
  }

  public static JSONArray regionsArray(Context context) {
    try {
      return new JSONArray(regionsJson(context));
    } catch (Exception e) {
      return new JSONArray();
    }
  }

  public static JSONObject gateById(Context context, String id) {
    if (id == null || id.trim().isEmpty()) return null;
    JSONArray arr = regionsArray(context);
    for (int i = 0; i < arr.length(); i++) {
      JSONObject o = arr.optJSONObject(i);
      if (o != null && id.equals(o.optString("id", ""))) return o;
    }
    return null;
  }

  /**
   * Per-gate Auto-open. Regions JSON stores every openable gate for Android Auto;
   * only {@code enabled: true} pins may auto-open or keep a Play Services fence.
   * Missing {@code enabled} (older JSON) stays eligible.
   */
  public static boolean isAutoEnabled(JSONObject gate) {
    if (gate == null) return false;
    return !gate.has("enabled") || gate.optBoolean("enabled", false);
  }

  /** User display name; never the PalGate backend name when displayName was synced. */
  public static String displayLabel(JSONObject gate) {
    if (gate == null) return "Gate";
    String display = gate.optString("displayName", "").trim();
    if (!display.isEmpty()) return display;
    String name = gate.optString("name", "").trim();
    if (!name.isEmpty()) return name;
    String deviceId = gate.optString("deviceId", "").trim();
    return deviceId.isEmpty() ? "Gate" : deviceId;
  }

  public static String regionsJson(Context context) {
    return prefs(context).getString(KEY_REGIONS, "[]");
  }

  /**
   * Off→On / pin-list rewrite: remove+add so disabled IDs cannot linger.
   * Never INITIAL_TRIGGER (EXIT would open every other pin). Marks the 12s
   * EXIT-only suppress window. Alarm / SCREEN_ON must call {@link #refresh}
   * instead — skipping Play here is how Samsung drops fences in the background.
   *
   * @param initialTrigger ignored; always 0
   * @return true if Play was asked to rewrite
   */
  public static boolean register(Context context, boolean initialTrigger) {
    Context app = context.getApplicationContext();
    String json = regionsJson(app);
    String sig = fenceSignature(json);
    if (fenceSigUnchanged(app, sig)) {
      Log.i(TAG, "native geofences unchanged — skip unregister+register");
      return false;
    }
    // 12s EXIT ignore only after Off→On / geometry rewrite (fake EXIT).
    KeepAlivePrefs.markGeofenceSync(app);
    // Inside marks from the old geometry are stale after a pin/list change.
    KeepAlivePrefs.clearAllInside(app);
    List<Geofence> geofences = parseGeofences(json);
    GeofencingClient client = LocationServices.getGeofencingClient(app);
    PendingIntent pi = pending(app);

    // addGeofences does not drop IDs that left the list (Auto toggled off).
    // Always remove first so a disabled gate cannot keep a stale fence.
    Runnable add =
      () -> {
        if (geofences.isEmpty()) {
          saveFenceSig(app, sig);
          Log.i(TAG, "native geofences cleared");
          return;
        }
        // Always 0. INITIAL_TRIGGER_EXIT fires for every pin the user is already
        // outside (Off→On / install / re-arm) — that is not "just left".
        // INITIAL_TRIGGER_ENTER is already-inside spam (JS eligible-now / poll).
        if (initialTrigger) {
          Log.i(TAG, "native geofence register — ignoring requested initial trigger");
        }
        GeofencingRequest request =
          new GeofencingRequest.Builder()
            .setInitialTrigger(0)
            .addGeofences(geofences)
            .build();
        try {
          client
            .addGeofences(request, pi)
            .addOnSuccessListener(
              unused -> {
                saveFenceSig(app, sig);
                Log.i(TAG, "native geofences registered: " + geofences.size());
              })
            .addOnFailureListener(e -> Log.w(TAG, "addGeofences failed", e));
        } catch (SecurityException e) {
          Log.w(TAG, "addGeofences denied", e);
        } catch (Exception e) {
          Log.w(TAG, "addGeofences error", e);
        }
      };

    try {
      client
        .removeGeofences(pi)
        .addOnCompleteListener(
          task -> {
            if (!task.isSuccessful()) {
              Log.w(TAG, "removeGeofences before register failed", task.getException());
            }
            add.run();
          });
    } catch (Exception e) {
      Log.w(TAG, "removeGeofences before register error", e);
      add.run();
    }
    return true;
  }

  /**
   * Keep Play fences alive without tearing them down. addGeofences replaces
   * same request IDs; INITIAL_TRIGGER stays 0 so this is not an ENTER/EXIT.
   * Does not mark the 12s Off→On suppress window (that swallowed real enters).
   */
  public static void refresh(Context context) {
    Context app = context.getApplicationContext();
    String json = regionsJson(app);
    List<Geofence> geofences = parseGeofences(json);
    if (geofences.isEmpty()) {
      Log.i(TAG, "native geofence refresh — no enabled fences");
      return;
    }
    GeofencingClient client = LocationServices.getGeofencingClient(app);
    GeofencingRequest request =
      new GeofencingRequest.Builder()
        .setInitialTrigger(0)
        .addGeofences(geofences)
        .build();
    try {
      client
        .addGeofences(request, pending(app))
        .addOnSuccessListener(
          unused -> {
            saveFenceSig(app, fenceSignature(json));
            Log.i(
              TAG,
              "native geofences refreshed: " + geofences.size() + " (no initial trigger)"
            );
          })
        .addOnFailureListener(e -> Log.w(TAG, "refresh addGeofences failed", e));
    } catch (SecurityException e) {
      Log.w(TAG, "refresh addGeofences denied", e);
    } catch (Exception e) {
      Log.w(TAG, "refresh addGeofences error", e);
    }
  }

  /** Forget last Play write so the next {@link #register} actually remove+adds. */
  public static void invalidateRegisteredSig(Context context) {
    prefs(context).edit().remove(KEY_FENCE_SIG).remove(KEY_FENCE_ELAPSED).apply();
  }

  /** Drop Play Services fences but keep the gate list (Android Auto still needs it). */
  public static void unregister(Context context) {
    invalidateRegisteredSig(context);
    KeepAlivePrefs.clearAllInside(context);
    try {
      LocationServices.getGeofencingClient(context.getApplicationContext())
        .removeGeofences(pending(context.getApplicationContext()));
      Log.i(TAG, "native geofences unregistered");
    } catch (Exception e) {
      Log.w(TAG, "unregister geofences failed", e);
    }
  }

  public static void clear(Context context) {
    saveRegionsJson(context, "[]");
    unregister(context);
  }

  static PendingIntent pending(Context context) {
    Intent intent = new Intent(context, GeofenceTransitionReceiver.class);
    intent.setAction("com.gateauto.app.GEOFENCE_TRANSITION");
    int flags = PendingIntent.FLAG_UPDATE_CURRENT;
    // Play Services must write event extras into this intent.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      flags |= PendingIntent.FLAG_MUTABLE;
    }
    return PendingIntent.getBroadcast(context, PI_REQ, intent, flags);
  }

  private static List<Geofence> parseGeofences(String json) {
    List<Geofence> out = new ArrayList<>();
    if (json == null || json.trim().isEmpty()) return out;
    try {
      JSONArray arr = new JSONArray(json);
      for (int i = 0; i < arr.length(); i++) {
        JSONObject o = arr.getJSONObject(i);
        String id = o.optString("id", "").trim();
        double lat = o.optDouble("lat", Double.NaN);
        double lng = o.optDouble("lng", Double.NaN);
        double radius = o.optDouble("radius", Double.NaN);
        if (id.isEmpty() || !Double.isFinite(lat) || !Double.isFinite(lng) || !(radius > 0)) {
          continue;
        }
        // AA stores all openable gates in this JSON; only enabled pins get fences.
        if (!isAutoEnabled(o)) {
          continue;
        }
        out.add(
          new Geofence.Builder()
            .setRequestId(id)
            .setCircularRegion(lat, lng, (float) radius)
            .setExpirationDuration(Geofence.NEVER_EXPIRE)
            .setTransitionTypes(
              Geofence.GEOFENCE_TRANSITION_ENTER | Geofence.GEOFENCE_TRANSITION_EXIT)
            .build()
        );
      }
    } catch (Exception e) {
      Log.w(TAG, "parseGeofences failed", e);
    }
    return out;
  }

  /**
   * Stable id|lat|lng|radius for enabled pins only. Rename / BT-check / display
   * name do not change this — those must not tear down Play fences.
   */
  static String fenceSignature(String json) {
    List<String> parts = new ArrayList<>();
    if (json == null || json.trim().isEmpty()) return "";
    try {
      JSONArray arr = new JSONArray(json);
      for (int i = 0; i < arr.length(); i++) {
        JSONObject o = arr.optJSONObject(i);
        if (o == null) continue;
        String id = o.optString("id", "").trim();
        double lat = o.optDouble("lat", Double.NaN);
        double lng = o.optDouble("lng", Double.NaN);
        double radius = o.optDouble("radius", Double.NaN);
        if (id.isEmpty() || !Double.isFinite(lat) || !Double.isFinite(lng) || !(radius > 0)) {
          continue;
        }
        if (!isAutoEnabled(o)) continue;
        parts.add(String.format(Locale.US, "%s|%.7f|%.7f|%.2f", id, lat, lng, radius));
      }
    } catch (Exception e) {
      Log.w(TAG, "fenceSignature failed", e);
    }
    Collections.sort(parts);
    StringBuilder sb = new StringBuilder();
    for (int i = 0; i < parts.size(); i++) {
      if (i > 0) sb.append(';');
      sb.append(parts.get(i));
    }
    return sb.toString();
  }

  private static boolean fenceSigUnchanged(Context app, String sig) {
    String prev = prefs(app).getString(KEY_FENCE_SIG, null);
    if (prev == null || !sig.equals(prev)) return false;
    long elapsedAt = prefs(app).getLong(KEY_FENCE_ELAPSED, -1L);
    long nowElapsed = SystemClock.elapsedRealtime();
    // elapsedRealtime resets on reboot; Play drops fences then.
    if (elapsedAt >= 0L && nowElapsed + 5_000L < elapsedAt) {
      Log.i(TAG, "native geofence sig match but uptime went backwards — reboot rewrite");
      return false;
    }
    return true;
  }

  private static void saveFenceSig(Context app, String sig) {
    prefs(app)
      .edit()
      .putString(KEY_FENCE_SIG, sig == null ? "" : sig)
      .putLong(KEY_FENCE_ELAPSED, SystemClock.elapsedRealtime())
      .apply();
  }

  private static SharedPreferences prefs(Context context) {
    return context.getApplicationContext().getSharedPreferences(PREF, Context.MODE_PRIVATE);
  }
}
