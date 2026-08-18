package com.gateauto.app.keepalive;

import android.app.ActivityManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.content.Context;
import android.location.Location;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import com.google.android.gms.tasks.CancellationTokenSource;
import com.google.android.gms.tasks.Tasks;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.TimeUnit;

import com.gateauto.app.R;

/**
 * Opens a PalGate from a BroadcastReceiver without React Native.
 * Android 14 blocks starting a shortService FGS from the background; this
 * HTTP call is what PalGate itself does while locked.
 */
public final class PalGateNativeOpen {
  private static final String TAG = "GateAutoKeepAlive";
  private static final String BASE = "https://api1.pal-es.com/v1/bt/";
  private static final double ABSOLUTE_MAX_M = 250.0;
  /**
   * Swallow Play EXIT that arrives immediately after Off→On remove+add.
   * Alarm/recover refresh must not mark this window (that swallowed real enters).
   */
  private static final long GEOFENCE_SYNC_SUPPRESS_MS = 12_000L;
  private static final String NOTIF_CHANNEL = "gateauto";

  private PalGateNativeOpen() {}

  /**
   * Deliberate open from Android Auto (same as in-app Manual Open): credentials +
   * deviceId required; no geofence, BT, cooldown, or auto safety lock.
   *
   * @return null on success, otherwise a short error for CarToast
   */
  public static String openManual(Context context, String gateId) {
    JSONObject gate = GeofenceRegistrar.gateById(context, gateId);
    if (gate == null) return "Unknown gate";
    String deviceId = gate.optString("deviceId", "").trim();
    if (deviceId.isEmpty()) return "Missing deviceId";
    if (!KeepAlivePrefs.hasCredentialsForGate(context, gateId)) return "Not linked to PalGate";
    try {
      httpOpen(context, deviceId, gateId);
      // Record last-open for auto cooldown, but do not applyBurst (auto-only lock).
      KeepAlivePrefs.setLastOpenedAt(context, gateId, System.currentTimeMillis());
      notifyOpened(context, GeofenceRegistrar.displayLabel(gate));
      Log.i(TAG, "native manual open OK " + gateId + " " + deviceId);
      return null;
    } catch (Exception e) {
      Log.w(TAG, "native manual open failed " + gateId, e);
      String msg = e.getMessage();
      return msg == null || msg.trim().isEmpty() ? "Open failed" : msg;
    }
  }

  public static void openFromGeofence(Context context, String gateId, String reason) {
    JSONObject gate = GeofenceRegistrar.gateById(context, gateId);
    if (gate == null) {
      Log.w(TAG, "native open: unknown gate " + gateId);
      return;
    }
    if (!GeofenceRegistrar.isAutoEnabled(gate)) {
      Log.i(TAG, "native open skip " + gateId + " — auto-open off (stale fence)");
      KeepAlivePrefs.setInside(context, gateId, false);
      return;
    }
    boolean isExit = "exit".equals(reason);
    if (isExit) {
      long synced = KeepAlivePrefs.lastGeofenceSyncAt(context);
      long age = synced > 0 ? System.currentTimeMillis() - synced : Long.MAX_VALUE;
      if (age >= 0 && age < GEOFENCE_SYNC_SUPPRESS_MS) {
        Log.i(
          TAG,
          "native open skip "
            + gateId
            + " (exit) — within "
            + GEOFENCE_SYNC_SUPPRESS_MS
            + "ms of Off→On rewrite (fake EXIT)"
        );
        return;
      }
    }
    Location last = lastLocation(context);
    if (isExit) {
      // Play already decided they left. Do not require a prior ENTER mark.
      // Missing last loc: still allow (fused last is often empty while locked).
      // Present last loc: only the 250m city cap — not radius×1.1 fail-closed.
      if (last != null) {
        double meters = distanceMeters(gate, last);
        if (Double.isFinite(meters) && meters > ABSOLUTE_MAX_M) {
          Log.i(
            TAG,
            "native open skip "
              + gateId
              + " (exit) — last loc "
              + String.format(Locale.US, "%.1fm", meters)
              + " beyond "
              + (int) ABSOLUTE_MAX_M
              + "m city cap"
          );
          return;
        }
      }
      KeepAlivePrefs.setInside(context, gateId, false);
      Log.i(
        TAG,
        "native exit allowed "
          + gateId
          + " last="
          + (last == null
            ? "missing"
            : String.format(Locale.US, "%.1fm", distanceMeters(gate, last)))
      );
    } else {
      if (last != null) {
        double meters = distanceMeters(gate, last);
        if (Double.isFinite(meters) && meters > ABSOLUTE_MAX_M) {
          Log.i(
            TAG,
            "native open skip "
              + gateId
              + " ("
              + reason
              + ") — last loc "
              + String.format(Locale.US, "%.1fm", meters)
              + " beyond city cap"
          );
          return;
        }
        if (!withinFence(gate, last, 1.0)) {
          Log.i(
            TAG,
            "native open skip "
              + gateId
              + " ("
              + reason
              + ") — not near pin ("
              + String.format(Locale.US, "%.1f", meters)
              + "m)"
          );
          return;
        }
      }
      KeepAlivePrefs.setInside(context, gateId, true);
      Log.i(TAG, "native mark inside " + gateId + " (enter)");
    }
    if (gate.optBoolean("btRequired", false) && !bluetoothMatches(context, gate, null)) {
      Log.i(TAG, "native open skip " + gateId + " — car BT not connected");
      return;
    }
    openGateObject(context, gate, reason);
  }

  public static void openFromBluetooth(
    Context context,
    String name,
    String address
  ) {
    JSONArray arr = GeofenceRegistrar.regionsArray(context);
    if (arr == null) return;
    Location last = lastLocation(context);
    for (int i = 0; i < arr.length(); i++) {
      JSONObject gate = arr.optJSONObject(i);
      if (gate == null) continue;
      if (!GeofenceRegistrar.isAutoEnabled(gate)) continue;
      if (!gate.optBoolean("btRequired", false)) continue;
      if (!deviceWanted(gate, address, name)) {
        Log.i(
          TAG,
          "native BT skip "
            + gate.optString("id")
            + " — "
            + name
            + " "
            + address
            + " is not a listed car"
        );
        continue;
      }
      if (last != null && !withinFence(gate, last, 1.0)) {
        Log.i(TAG, "native BT skip " + gate.optString("id") + " — not near pin");
        continue;
      }
      KeepAlivePrefs.setInside(context, gate.optString("id"), true);
      openGateObject(context, gate, "bt");
    }
  }

  /**
   * Recover / cooldown: open auto-enabled gates whose last loc is inside the
   * pin radius (Samsung often never delivers ENTER while locked). Guards:
   * armed, last loc present, within radius (250m cap), cooldown/safety lock,
   * credentials. BT-required: listed car currently connected — not any HID.
   * Never starts a location FGS (Android 12+ blocks that from this receiver).
   */
  public static void pollNearby(Context context) {
    if (!KeepAlivePrefs.isArmed(context)) {
      Log.i(TAG, "native poll skip — not armed");
      return;
    }
    JSONArray arr = GeofenceRegistrar.regionsArray(context);
    if (arr == null || arr.length() == 0) {
      Log.w(TAG, "native poll — empty native regions (locked cannot open)");
      return;
    }
    Location last = resolvePollLocation(context);
    if (last == null) {
      return;
    }
    int auto = 0;
    int inside = 0;
    for (int i = 0; i < arr.length(); i++) {
      JSONObject gate = arr.optJSONObject(i);
      if (gate == null) continue;
      if (!GeofenceRegistrar.isAutoEnabled(gate)) continue;
      auto++;
      String id = gate.optString("id", "").trim();
      double meters = distanceMeters(gate, last);
      if (!withinFence(gate, last, 1.0)) {
        Log.i(
          TAG,
          "native poll skip "
            + id
            + " — not inside ("
            + (Double.isFinite(meters)
              ? String.format(Locale.US, "%.1fm", meters)
              : "no pin")
            + ")"
        );
        continue;
      }
      inside++;
      if (!id.isEmpty() && !KeepAlivePrefs.isInside(context, id)) {
        Log.i(TAG, "native mark inside " + id + " (poll, already inside — no Play ENTER)");
      }
      if (!id.isEmpty()) KeepAlivePrefs.setInside(context, id, true);
      if (gate.optBoolean("btRequired", false)
        && !bluetoothMatches(context, gate, null)) {
        Log.i(
          TAG,
          "native poll skip "
            + id
            + " — BT-required (listed car not connected; poll is not a car-connect)"
        );
        continue;
      }
      openGateObject(context, gate, "poll");
    }
    Log.i(
      TAG,
      "native poll done — regions="
        + arr.length()
        + " auto="
        + auto
        + " inside="
        + inside
    );
  }

  private static void openGateObject(Context context, JSONObject gate, String reason) {
    String gateId = gate.optString("id", "").trim();
    String deviceId = gate.optString("deviceId", "").trim();
    long cooldownMs = gate.optLong("cooldownMs", 30_000L);
    if (gateId.isEmpty() || deviceId.isEmpty()) {
      Log.w(TAG, "native open skip — missing id/deviceId");
      return;
    }
    if (!GeofenceRegistrar.isAutoEnabled(gate)) {
      Log.i(TAG, "native open skip " + gateId + " — auto-open off");
      return;
    }
    if (!KeepAlivePrefs.hasCredentialsForGate(context, gateId)) {
      Log.w(TAG, "native open skip — no credentials");
      return;
    }
    if (!KeepAlivePrefs.tryClaimOpen(context, gateId, cooldownMs)) {
      Log.i(TAG, "native open skip " + gateId + " — cooldown/lock/in-flight");
      return;
    }
    try {
      httpOpen(context, deviceId, gateId);
      boolean lockEngaged = KeepAlivePrefs.markOpened(context, gateId);
      KeepAliveScheduler.scheduleCooldownWake(context, Math.max(3_000L, cooldownMs + 1_500L));
      String label = GeofenceRegistrar.displayLabel(gate);
      notifyOpened(context, label);
      long ts = System.currentTimeMillis();
      KeepAlivePrefs.appendNativeEvent(
        context,
        nativeOpenKind(reason),
        gateId,
        label + ": native " + reason + " open · deviceId " + deviceId,
        nativeOpenTrigger(reason),
        ts
      );
      if (lockEngaged) {
        KeepAlivePrefs.appendNativeEvent(
          context,
          "safety_lock",
          gateId,
          label + ": Safety lock engaged for 40m (4 auto-opens in 2m)",
          nativeOpenTrigger(reason),
          ts
        );
      }
      Log.i(
        TAG,
        "native open OK "
          + gateId
          + " ("
          + reason
          + ") "
          + deviceId
          + " "
          + label
          + " btRequired="
          + gate.optBoolean("btRequired", false)
      );
    } catch (Exception e) {
      KeepAlivePrefs.releaseClaim(gateId);
      Log.w(TAG, "native open failed " + gateId, e);
    }
  }

  private static void httpOpen(Context context, String deviceId, String gateId) throws Exception {
    String trimmed = deviceId.trim();
    String baseId = trimmed;
    int outputNum = 1;
    int colon = trimmed.lastIndexOf(':');
    if (colon > 0) {
      try {
        int n = Integer.parseInt(trimmed.substring(colon + 1));
        if (n > 0) {
          outputNum = n;
          baseId = trimmed.substring(0, colon);
        }
      } catch (NumberFormatException ignored) {
        // keep whole id
      }
    }
    String token =
      PalGateToken.generate(
        KeepAlivePrefs.sessionTokenForGate(context, gateId),
        KeepAlivePrefs.phoneNumberForGate(context, gateId),
        KeepAlivePrefs.tokenTypeForGate(context, gateId),
        System.currentTimeMillis() / 1000L
      );
    String url =
      BASE
        + "device/"
        + baseId
        + "/open-gate?outputNum="
        + outputNum
        + "&_="
        + System.currentTimeMillis();
    HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
    try {
      conn.setRequestMethod("GET");
      conn.setUseCaches(false);
      conn.setConnectTimeout(10_000);
      conn.setReadTimeout(10_000);
      conn.setRequestProperty("Accept", "*/*");
      conn.setRequestProperty("Accept-Language", "en-us");
      conn.setRequestProperty("Content-Type", "application/json");
      conn.setRequestProperty("User-Agent", "okhttp/4.9.3");
      conn.setRequestProperty("Cache-Control", "no-cache, no-store");
      conn.setRequestProperty("Pragma", "no-cache");
      conn.setRequestProperty("X-Bt-Token", token);
      int status = conn.getResponseCode();
      InputStream stream =
        status >= 400 ? conn.getErrorStream() : conn.getInputStream();
      String body = readAll(stream);
      if (status < 200 || status >= 300) {
        throw new IllegalStateException("HTTP " + status + " " + body);
      }
      if (body == null || body.trim().isEmpty() || body.trim().charAt(0) != '{') {
        throw new IllegalStateException("empty/non-JSON open-gate body");
      }
      JSONObject env = new JSONObject(body);
      if (envelopeFailed(env)) {
        throw new IllegalStateException(env.optString("msg", "open-gate error"));
      }
    } finally {
      conn.disconnect();
    }
  }

  private static boolean envelopeFailed(JSONObject env) {
    if (env.has("err")) {
      Object err = env.opt("err");
      if (err instanceof Boolean && (Boolean) err) return true;
      if (err instanceof String && ((String) err).length() > 0) return true;
      if (err instanceof Number && ((Number) err).intValue() != 0) return true;
    }
    if (env.has("status")) {
      String status = env.optString("status", "ok");
      return !"ok".equals(status);
    }
    return false;
  }

  private static String readAll(InputStream stream) throws Exception {
    if (stream == null) return "";
    BufferedReader reader = new BufferedReader(new InputStreamReader(stream));
    StringBuilder sb = new StringBuilder();
    String line;
    while ((line = reader.readLine()) != null) {
      sb.append(line);
    }
    return sb.toString();
  }

  private static String nativeOpenKind(String reason) {
    if ("exit".equals(reason)) return "exit_open";
    if ("bt".equals(reason)) return "bt_connect_open";
    if ("poll".equals(reason)) return "poll_open";
    return "opened";
  }

  private static String nativeOpenTrigger(String reason) {
    if ("bt".equals(reason)) return "bt_connect";
    if ("exit".equals(reason) || "enter".equals(reason) || "poll".equals(reason)) {
      return reason;
    }
    return "poll";
  }

  private static boolean withinFence(JSONObject gate, Location loc, double factor) {
    double meters = distanceMeters(gate, loc);
    if (!Double.isFinite(meters)) return false;
    double radius = gate.optDouble("radius", Double.NaN);
    if (!(radius > 0)) return false;
    double cap = Math.min(radius * factor, ABSOLUTE_MAX_M);
    return meters <= cap;
  }

  private static double distanceMeters(JSONObject gate, Location loc) {
    if (loc == null) return Double.NaN;
    double lat = gate.optDouble("lat", Double.NaN);
    double lng = gate.optDouble("lng", Double.NaN);
    if (!Double.isFinite(lat) || !Double.isFinite(lng)) return Double.NaN;
    float[] out = new float[1];
    Location.distanceBetween(lat, lng, loc.getLatitude(), loc.getLongitude(), out);
    return out[0];
  }

  /**
   * Fused getLastLocation first (no FGS). If empty and a location FGS is
   * already running, request a fix in that process. Never startForegroundService.
   */
  private static Location resolvePollLocation(Context context) {
    Location last = lastLocation(context);
    if (last != null) {
      Log.i(TAG, "native poll loc=fused last");
      return last;
    }
    boolean fgs = locationFgsRunning(context);
    if (!fgs) {
      Log.w(
        TAG,
        "native poll — no last location (location FGS not running; not starting FGS from background). Samsung: Settings → Apps → GateAuto → Battery → Unrestricted so the keep-alive FGS started at Auto-on can stay alive while locked."
      );
      return null;
    }
    Log.i(TAG, "native poll — no last loc, requesting in existing FGS");
    Location fresh =
      MonitoringService.isRunning()
        ? MonitoringService.awaitFreshLocation(8_000L)
        : currentLocationNoNewFgs(context);
    if (fresh == null) {
      Log.w(TAG, "native poll — no last location (FGS running but getCurrentLocation empty)");
    }
    return fresh;
  }

  private static Location lastLocation(Context context) {
    try {
      FusedLocationProviderClient fused =
        LocationServices.getFusedLocationProviderClient(context);
      return Tasks.await(fused.getLastLocation(), 4, TimeUnit.SECONDS);
    } catch (Exception e) {
      Log.w(TAG, "lastLocation failed", e);
      return null;
    }
  }

  private static Location currentLocationNoNewFgs(Context context) {
    try {
      FusedLocationProviderClient fused =
        LocationServices.getFusedLocationProviderClient(context);
      CancellationTokenSource cancel = new CancellationTokenSource();
      return Tasks.await(
        fused.getCurrentLocation(
          Priority.PRIORITY_BALANCED_POWER_ACCURACY,
          cancel.getToken()
        ),
        8,
        TimeUnit.SECONDS
      );
    } catch (Exception e) {
      Log.w(TAG, "getCurrentLocation failed", e);
      return null;
    }
  }

  static boolean locationFgsRunning(Context context) {
    if (MonitoringService.isRunning()) return true;
    ActivityManager am =
      (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
    if (am == null) return false;
    String pkg = context.getPackageName();
    try {
      for (ActivityManager.RunningServiceInfo info : am.getRunningServices(64)) {
        if (info.service == null || !pkg.equals(info.service.getPackageName())) {
          continue;
        }
        if (!info.foreground) continue;
        String cls = info.service.getClassName();
        if (cls == null) continue;
        if (cls.contains("LocationTaskService")
          || cls.contains("MonitoringService")
          || cls.contains("KeepAliveService")) {
          return true;
        }
      }
    } catch (Exception e) {
      Log.w(TAG, "locationFgsRunning failed", e);
    }
    return false;
  }

  private static boolean deviceWanted(JSONObject gate, String address, String name) {
    JSONArray addrs = gate.optJSONArray("btAddresses");
    JSONArray names = gate.optJSONArray("btNames");
    boolean hasAddr = addrs != null && addrs.length() > 0;
    boolean hasName = names != null && names.length() > 0;
    // Fail closed: BT-required with no listed car must not match a random device.
    if (!hasAddr && !hasName) return false;
    String na = normalizeAddr(address);
    if (hasAddr && !na.isEmpty()) {
      for (int i = 0; i < addrs.length(); i++) {
        if (na.equals(normalizeAddr(addrs.optString(i, "")))) return true;
      }
    }
    return nameMatches(gate, name);
  }

  private static boolean nameMatches(JSONObject gate, String name) {
    if (name == null || name.trim().isEmpty()) return false;
    JSONArray names = gate.optJSONArray("btNames");
    if (names == null) return false;
    String needle = name.trim().toLowerCase(Locale.US);
    for (int i = 0; i < names.length(); i++) {
      String n = names.optString(i, "");
      if (!n.isEmpty() && n.trim().toLowerCase(Locale.US).equals(needle)) return true;
    }
    return false;
  }

  /**
   * BT-required gates open only when a <em>listed</em> car is connected (address OR
   * name). HID/GATT/A2DP/HEADSET are ways to <em>see</em> that car — a random
   * HID keyboard or watch does not satisfy the gate.
   */
  private static boolean bluetoothMatches(
    Context context,
    JSONObject gate,
    String extraAddress
  ) {
    boolean require = gate.optBoolean("btRequired", false);
    if (!require && extraAddress == null) return true;

    Set<String> wantAddr = new HashSet<>();
    JSONArray addrs = gate.optJSONArray("btAddresses");
    if (addrs != null) {
      for (int i = 0; i < addrs.length(); i++) {
        String a = normalizeAddr(addrs.optString(i, ""));
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
    if (wantAddr.isEmpty() && wantName.isEmpty()) {
      Log.i(
        TAG,
        "native BT skip "
          + gate.optString("id")
          + " — required but no listed car address/name"
      );
      return false;
    }

    if (extraAddress != null) {
      String extra = normalizeAddr(extraAddress);
      if (!extra.isEmpty() && wantAddr.contains(extra)) return true;
    }

    Set<String> connectedAddr = connectedAddresses(context);
    for (String a : wantAddr) {
      if (connectedAddr.contains(a)) return true;
    }
    Set<String> connectedName = connectedNames(context);
    for (String n : wantName) {
      if (connectedName.contains(n)) return true;
    }
    Log.i(
      TAG,
      "native BT skip "
        + gate.optString("id")
        + " — listed car not in connected profiles (wantAddr="
        + wantAddr.size()
        + " wantName="
        + wantName.size()
        + " connected="
        + connectedAddr.size()
        + ")"
    );
    return false;
  }

  private static String normalizeAddr(String raw) {
    return raw == null ? "" : raw.replace(":", "").replace("-", "").toLowerCase(Locale.US);
  }

  private static Set<String> connectedAddresses(Context context) {
    Set<String> out = new HashSet<>();
    BluetoothManager mgr =
      (BluetoothManager) context.getSystemService(Context.BLUETOOTH_SERVICE);
    if (mgr == null) return out;
    int[] profiles = {
      BluetoothProfile.HEADSET,
      BluetoothProfile.A2DP,
      BluetoothProfile.GATT,
      BluetoothProfile.GATT_SERVER,
      4, // HID_HOST
      19 // HID_DEVICE (cars / Android Auto)
    };
    for (int profile : profiles) {
      try {
        for (BluetoothDevice d : mgr.getConnectedDevices(profile)) {
          if (d.getAddress() != null) out.add(normalizeAddr(d.getAddress()));
        }
      } catch (SecurityException e) {
        Log.w(TAG, "BT connect list denied", e);
      } catch (Exception ignored) {
        // ignore
      }
    }
    return out;
  }

  private static Set<String> connectedNames(Context context) {
    Set<String> out = new HashSet<>();
    BluetoothManager mgr =
      (BluetoothManager) context.getSystemService(Context.BLUETOOTH_SERVICE);
    if (mgr == null) return out;
    int[] profiles = {
      BluetoothProfile.HEADSET,
      BluetoothProfile.A2DP,
      BluetoothProfile.GATT,
      BluetoothProfile.GATT_SERVER,
      4, // HID_HOST
      19 // HID_DEVICE (cars / Android Auto)
    };
    for (int profile : profiles) {
      collectProfile(mgr, profile, out);
    }
    return out;
  }

  private static void collectProfile(
    BluetoothManager mgr,
    int profile,
    Set<String> out
  ) {
    try {
      for (BluetoothDevice d : mgr.getConnectedDevices(profile)) {
        String n = d.getName();
        if (n != null) out.add(n.trim().toLowerCase(Locale.US));
      }
    } catch (Exception ignored) {
      // ignore
    }
  }

  private static void notifyOpened(Context context, String label) {
    try {
      NotificationManager nm = context.getSystemService(NotificationManager.class);
      if (nm == null) return;
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        NotificationChannel channel =
          new NotificationChannel(NOTIF_CHANNEL, "GateAuto", NotificationManager.IMPORTANCE_HIGH);
        nm.createNotificationChannel(channel);
      }
      nm.notify(
        (int) (System.currentTimeMillis() % 100000),
        new NotificationCompat.Builder(context, NOTIF_CHANNEL)
          .setContentTitle("Gate opened")
          .setContentText(label == null || label.isEmpty() ? "Gate" : label)
          .setSmallIcon(R.mipmap.ic_launcher)
          .setAutoCancel(true)
          .build()
      );
    } catch (Exception e) {
      Log.w(TAG, "notifyOpened failed", e);
    }
  }
}
