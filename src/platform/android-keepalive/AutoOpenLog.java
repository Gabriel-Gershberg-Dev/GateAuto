package com.gateauto.app.keepalive;

import android.content.Context;
import android.content.pm.PackageManager;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Last 300 auto-open decisions on the phone, plus a Firestore upload when a
 * signed-in token is still valid. No coordinates, phone numbers, or tokens.
 */
public final class AutoOpenLog {
  private static final String TAG = "GateAutoKeepAlive";
  static final int MAX_LINES = 300;
  private static final long SKIP_MIN_MS = 60_000L;
  private static final long ALARM_MIN_MS = 10 * 60 * 1000L;
  private static final String KEY_LINES = "autoOpenLogLines";
  private static final String KEY_UID = "autoOpenLogUid";
  private static final String KEY_TOKEN = "autoOpenLogToken";
  private static final String KEY_EXP = "autoOpenLogExp";
  private static final String FIRESTORE =
    "https://firestore.googleapis.com/v1/projects/gateauto-app/databases/gateauto/documents/users/";

  private static final AtomicBoolean UPLOADING = new AtomicBoolean(false);
  private static volatile boolean pendingUpload = false;
  private static volatile long lastAlarmAt = 0L;
  private static final Map<String, Long> skipAt = new ConcurrentHashMap<>();

  private AutoOpenLog() {}

  static void open(
    Context context,
    String source,
    String gateId,
    Double distanceM,
    JSONObject gate,
    boolean warm
  ) {
    append(context, "open", source, "", gateId, distanceM, gate, warm);
  }

  static void fail(
    Context context,
    String source,
    String gateId,
    Double distanceM,
    JSONObject gate,
    boolean warm
  ) {
    append(context, "fail", source, "fail", gateId, distanceM, gate, warm);
  }

  /** Skip lines only while inside the wake distance, and at most once a minute. */
  static void skip(
    Context context,
    String reason,
    String source,
    String gateId,
    Double distanceM,
    JSONObject gate,
    boolean warm
  ) {
    if (!insideWake(distanceM, gate)) return;
    append(context, "skip", source, reason, gateId, distanceM, gate, warm);
  }

  static void boot(Context context) {
    append(context, "boot", "boot", "", "", null, null, MonitoringService.isForeground());
  }

  static void alarm(Context context) {
    long now = System.currentTimeMillis();
    if (lastAlarmAt > 0 && now - lastAlarmAt < ALARM_MIN_MS) return;
    lastAlarmAt = now;
    append(context, "alarm", "alarm", "", "", null, null, MonitoringService.isForeground());
  }

  public static void setAuth(Context context, String uid, String token, long expMs) {
    if (context == null) return;
    KeepAlivePrefs.prefs(context)
      .edit()
      .putString(KEY_UID, uid == null ? "" : uid.trim())
      .putString(KEY_TOKEN, token == null ? "" : token)
      .putLong(KEY_EXP, Math.max(0L, expMs))
      .commit();
    if (uid != null && !uid.trim().isEmpty() && token != null && !token.isEmpty()) {
      requestUpload(context);
    }
  }

  public static String linesJson(Context context) {
    if (context == null) return "[]";
    String raw = KeepAlivePrefs.prefs(context).getString(KEY_LINES, "[]");
    return raw == null || raw.isEmpty() ? "[]" : raw;
  }

  private static boolean insideWake(Double distanceM, JSONObject gate) {
    if (distanceM == null || !Double.isFinite(distanceM) || gate == null) return false;
    double detect = GeofenceRegistrar.detectRadiusMeters(gate);
    return detect > 0 && distanceM <= detect;
  }

  private static void append(
    Context context,
    String kind,
    String source,
    String reason,
    String gateId,
    Double distanceM,
    JSONObject gate,
    boolean warm
  ) {
    if (context == null) return;
    if ("skip".equals(kind) && throttledSkip(gateId, source, reason)) return;
    try {
      JSONObject line = new JSONObject();
      line.put("t", System.currentTimeMillis());
      line.put("v", versionName(context));
      line.put("kind", kind);
      line.put("source", clip(source, 24));
      line.put("reason", clip(reason, 24));
      line.put("gate", GateAutoTelemetry.hashGateId(gateId));
      String name = gate == null ? "" : GeofenceRegistrar.displayLabel(gate);
      if (name != null && !name.isEmpty() && !"Unknown gate".equals(name)) {
        line.put("name", clip(name, 80));
      }
      if (distanceM != null && Double.isFinite(distanceM)) {
        line.put("distanceM", (int) Math.round(Math.max(0, distanceM)));
      }
      if (gate != null) {
        double radius = gate.optDouble("radius", Double.NaN);
        if (radius > 0 && Double.isFinite(radius)) {
          line.put("radiusM", (int) Math.round(Math.min(250, radius)));
        }
      }
      line.put("walking", KeepAlivePrefs.walkingEnabled(context) ? 1 : 0);
      line.put("warm", warm ? 1 : 0);
      line.put("battery", AutoOpenPermissionStatus.isBatteryUnrestricted(context) ? 1 : 0);

      JSONArray lines = new JSONArray(linesJson(context));
      lines.put(line);
      if (lines.length() > MAX_LINES) {
        JSONArray trimmed = new JSONArray();
        for (int i = lines.length() - MAX_LINES; i < lines.length(); i++) {
          trimmed.put(lines.get(i));
        }
        lines = trimmed;
      }
      KeepAlivePrefs.prefs(context).edit().putString(KEY_LINES, lines.toString()).commit();
      requestUpload(context);
    } catch (Throwable t) {
      Log.w(TAG, "auto log append failed", t);
    }
  }

  private static void requestUpload(Context context) {
    pendingUpload = true;
    if (!UPLOADING.compareAndSet(false, true)) return;
    Context app = context.getApplicationContext();
    new Thread(
      () -> {
        try {
          while (pendingUpload) {
            pendingUpload = false;
            uploadOnce(app);
          }
        } catch (Throwable t) {
          Log.w(TAG, "auto log upload failed", t);
        } finally {
          UPLOADING.set(false);
          if (pendingUpload) requestUpload(app);
        }
      },
      "gateauto-autolog"
    ).start();
  }

  private static void uploadOnce(Context context) throws Exception {
    String uid = KeepAlivePrefs.prefs(context).getString(KEY_UID, "");
    String token = KeepAlivePrefs.prefs(context).getString(KEY_TOKEN, "");
    long exp = KeepAlivePrefs.prefs(context).getLong(KEY_EXP, 0L);
    if (uid == null || uid.isEmpty() || token == null || token.isEmpty()) return;
    if (exp < System.currentTimeMillis() + 30_000L) return;
    JSONArray local = new JSONArray(linesJson(context));
    if (local.length() == 0) return;
    JSONArray cloud = new JSONArray();
    for (int i = 0; i < local.length(); i++) {
      JSONObject line = local.getJSONObject(i);
      line.remove("name");
      cloud.put(line);
    }
    byte[] body = firestoreBody(cloud).getBytes(StandardCharsets.UTF_8);
    String url =
      FIRESTORE
        + java.net.URLEncoder.encode(uid, "UTF-8")
        + "/autoLog/recent";
    HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
    try {
      conn.setRequestMethod("POST");
      conn.setConnectTimeout(15_000);
      conn.setReadTimeout(15_000);
      conn.setDoOutput(true);
      conn.setRequestProperty("X-HTTP-Method-Override", "PATCH");
      conn.setRequestProperty("Authorization", "Bearer " + token);
      conn.setRequestProperty("Content-Type", "application/json");
      try (OutputStream out = conn.getOutputStream()) {
        out.write(body);
      }
      int code = conn.getResponseCode();
      if (code < 200 || code >= 300) {
        Log.w(TAG, "auto log upload HTTP " + code);
      }
    } finally {
      conn.disconnect();
    }
  }

  private static String firestoreBody(JSONArray lines) throws Exception {
    StringBuilder values = new StringBuilder();
    for (int i = 0; i < lines.length(); i++) {
      if (i > 0) values.append(',');
      values.append("{\"mapValue\":{\"fields\":");
      values.append(firestoreFields(lines.getJSONObject(i)));
      values.append("}}");
    }
    String now = utcNow();
    return "{\"fields\":{"
      + "\"lines\":{\"arrayValue\":{\"values\":[" + values + "]}},"
      + "\"updatedAt\":{\"timestampValue\":\"" + now + "\"}"
      + "}}";
  }

  private static String firestoreFields(JSONObject line) {
    StringBuilder fields = new StringBuilder();
    fields.append('{');
    boolean first = true;
    java.util.Iterator<String> keys = line.keys();
    while (keys.hasNext()) {
      String key = keys.next();
      if ("name".equals(key)) continue;
      Object value = line.opt(key);
      if (!first) fields.append(',');
      first = false;
      fields.append('"').append(jsonEscape(key)).append("\":");
      if (value instanceof Number) {
        fields.append("{\"integerValue\":\"").append(((Number) value).longValue()).append("\"}");
      } else {
        fields.append("{\"stringValue\":\"").append(jsonEscape(String.valueOf(value))).append("\"}");
      }
    }
    fields.append('}');
    return fields.toString();
  }

  private static boolean throttledSkip(String gateId, String source, String reason) {
    String key = clip(gateId, 80) + ":" + clip(source, 24) + ":" + clip(reason, 24);
    long now = System.currentTimeMillis();
    Long last = skipAt.get(key);
    if (last != null && now - last < SKIP_MIN_MS) return true;
    skipAt.put(key, now);
    return false;
  }

  private static String utcNow() {
    SimpleDateFormat fmt = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
    fmt.setTimeZone(TimeZone.getTimeZone("UTC"));
    return fmt.format(new Date());
  }

  private static String versionName(Context context) {
    try {
      String version =
        context.getPackageManager().getPackageInfo(context.getPackageName(), 0).versionName;
      if (version != null && !version.isEmpty()) return version;
    } catch (PackageManager.NameNotFoundException ignored) {
      // unknown
    }
    return "unknown";
  }

  private static String clip(String raw, int max) {
    if (raw == null) return "";
    String s = raw.replace('\n', ' ').replace('\r', ' ').trim();
    if (s.length() > max) return s.substring(0, max);
    return s;
  }

  private static String jsonEscape(String raw) {
    if (raw == null) return "";
    return raw
      .replace("\\", "\\\\")
      .replace("\"", "\\\"")
      .replace("\n", " ")
      .replace("\r", " ");
  }
}
