package com.gateauto.app.keepalive;

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
  private static final String NOTIF_CHANNEL = "gateauto";

  private PalGateNativeOpen() {}

  public static void openFromGeofence(Context context, String gateId, String reason) {
    JSONObject gate = GeofenceRegistrar.gateById(context, gateId);
    if (gate == null) {
      Log.w(TAG, "native open: unknown gate " + gateId);
      return;
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
      if (!gate.optBoolean("btRequired", false)) continue;
      if (!deviceWanted(gate, address, name)) continue;
      if (last != null && !withinFence(gate, last, 1.0)) {
        Log.i(TAG, "native BT skip " + gate.optString("id") + " — not near pin");
        continue;
      }
      openGateObject(context, gate, "bt");
    }
  }

  /** After cooldown: open any armed gate we are still inside. */
  public static void pollNearby(Context context) {
    if (!KeepAlivePrefs.isArmed(context)) return;
    JSONArray arr = GeofenceRegistrar.regionsArray(context);
    if (arr == null) return;
    Location last = lastLocation(context);
    if (last == null) {
      Log.w(TAG, "native poll — no last location");
      return;
    }
    for (int i = 0; i < arr.length(); i++) {
      JSONObject gate = arr.optJSONObject(i);
      if (gate == null) continue;
      if (!withinFence(gate, last, 1.0)) continue;
      if (gate.optBoolean("btRequired", false) && !bluetoothMatches(context, gate, null)) {
        continue;
      }
      openGateObject(context, gate, "poll");
    }
  }

  private static void openGateObject(Context context, JSONObject gate, String reason) {
    String gateId = gate.optString("id", "").trim();
    String deviceId = gate.optString("deviceId", "").trim();
    long cooldownMs = gate.optLong("cooldownMs", 30_000L);
    if (gateId.isEmpty() || deviceId.isEmpty()) {
      Log.w(TAG, "native open skip — missing id/deviceId");
      return;
    }
    if (!KeepAlivePrefs.hasCredentials(context)) {
      Log.w(TAG, "native open skip — no credentials");
      return;
    }
    if (!KeepAlivePrefs.tryClaimOpen(context, gateId, cooldownMs)) {
      Log.i(TAG, "native open skip " + gateId + " — cooldown/lock/in-flight");
      return;
    }
    try {
      httpOpen(context, deviceId);
      KeepAlivePrefs.markOpened(context, gateId);
      KeepAliveScheduler.scheduleCooldownWake(context, Math.max(3_000L, cooldownMs + 1_500L));
      notifyOpened(context, gate.optString("name", "Gate"));
      Log.i(TAG, "native open OK " + gateId + " (" + reason + ") " + deviceId);
    } catch (Exception e) {
      KeepAlivePrefs.releaseClaim(gateId);
      Log.w(TAG, "native open failed " + gateId, e);
    }
  }

  private static void httpOpen(Context context, String deviceId) throws Exception {
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
        KeepAlivePrefs.sessionToken(context),
        KeepAlivePrefs.phoneNumber(context),
        KeepAlivePrefs.tokenType(context),
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

  private static boolean withinFence(JSONObject gate, Location loc, double factor) {
    double lat = gate.optDouble("lat", Double.NaN);
    double lng = gate.optDouble("lng", Double.NaN);
    double radius = gate.optDouble("radius", Double.NaN);
    if (!Double.isFinite(lat) || !Double.isFinite(lng) || !(radius > 0)) return false;
    float[] out = new float[1];
    Location.distanceBetween(lat, lng, loc.getLatitude(), loc.getLongitude(), out);
    double cap = Math.min(radius * factor, ABSOLUTE_MAX_M);
    return out[0] <= cap;
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

  private static boolean deviceWanted(JSONObject gate, String address, String name) {
    JSONArray addrs = gate.optJSONArray("btAddresses");
    JSONArray names = gate.optJSONArray("btNames");
    boolean hasAddr = addrs != null && addrs.length() > 0;
    boolean hasName = names != null && names.length() > 0;
    if (!hasAddr && !hasName) return true;
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

  private static boolean bluetoothMatches(
    Context context,
    JSONObject gate,
    String extraAddress
  ) {
    JSONArray addrs = gate.optJSONArray("btAddresses");
    JSONArray names = gate.optJSONArray("btNames");
    boolean require = gate.optBoolean("btRequired", false);
    if (!require && extraAddress == null) return true;
    Set<String> want = new HashSet<>();
    if (addrs != null) {
      for (int i = 0; i < addrs.length(); i++) {
        String a = normalizeAddr(addrs.optString(i, ""));
        if (!a.isEmpty()) want.add(a);
      }
    }
    if (extraAddress != null) {
      String extra = normalizeAddr(extraAddress);
      if (!extra.isEmpty() && (want.isEmpty() || want.contains(extra))) {
        if (!want.isEmpty()) return true;
      }
      if (!want.isEmpty() && want.contains(extra)) return true;
    }
    Set<String> connected = connectedAddresses(context);
    for (String a : want) {
      if (connected.contains(a)) return true;
    }
    if (names != null && names.length() > 0) {
      Set<String> connectedNames = connectedNames(context);
      for (int i = 0; i < names.length(); i++) {
        String n = names.optString(i, "").trim().toLowerCase(Locale.US);
        if (!n.isEmpty() && connectedNames.contains(n)) return true;
      }
    }
    return extraAddress != null && want.isEmpty() && !require;
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
      BluetoothProfile.A2DP,
      BluetoothProfile.HEADSET,
      BluetoothProfile.GATT
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
    try {
      for (BluetoothDevice d : mgr.getConnectedDevices(BluetoothProfile.A2DP)) {
        String n = d.getName();
        if (n != null) out.add(n.trim().toLowerCase(Locale.US));
      }
    } catch (Exception ignored) {
      // ignore
    }
    return out;
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
