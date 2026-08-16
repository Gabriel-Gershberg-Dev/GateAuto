package com.gateauto.app.keepalive;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

import com.google.android.gms.location.Geofence;
import com.google.android.gms.location.GeofencingClient;
import com.google.android.gms.location.GeofencingRequest;
import com.google.android.gms.location.LocationServices;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Play Services geofences owned by GateAuto — not Expo TaskManager/JobScheduler.
 * JobScheduler is what Samsung delays for hours while the screen is locked.
 */
public final class GeofenceRegistrar {
  private static final String TAG = "GateAutoKeepAlive";
  private static final String PREF = "gateauto_keepalive";
  private static final String KEY_REGIONS = "regionsJson";
  private static final int PI_REQ = 71011;

  private GeofenceRegistrar() {}

  public static void saveRegionsJson(Context context, String json) {
    prefs(context).edit().putString(KEY_REGIONS, json == null ? "[]" : json).apply();
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

  public static void register(Context context, boolean initialTrigger) {
    Context app = context.getApplicationContext();
    KeepAlivePrefs.markGeofenceSync(app);
    List<Geofence> geofences = parseGeofences(regionsJson(app));
    GeofencingClient client = LocationServices.getGeofencingClient(app);
    PendingIntent pi = pending(app);

    // addGeofences does not drop IDs that left the list (Auto toggled off).
    // Always remove first so a disabled gate cannot keep a stale fence.
    Runnable add =
      () -> {
        if (geofences.isEmpty()) {
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
              unused -> Log.i(TAG, "native geofences registered: " + geofences.size()))
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
  }

  /** Drop Play Services fences but keep the gate list (Android Auto still needs it). */
  public static void unregister(Context context) {
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

  private static SharedPreferences prefs(Context context) {
    return context.getApplicationContext().getSharedPreferences(PREF, Context.MODE_PRIVATE);
  }
}
