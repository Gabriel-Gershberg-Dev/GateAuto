package com.gateauto.app.keepalive;

import android.content.Context;
import android.content.SharedPreferences;
import android.location.Location;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/** Native mirror of JS monitoring-enabled, credentials, and last-open times. */
public final class KeepAlivePrefs {
  private static final String PREF = "gateauto_keepalive";
  private static final String KEY_ARMED = "armed";
  /** Master shade switch. Default on. Does not arm or disarm Auto-open. */
  private static final String KEY_NOTICES = "noticesEnabled";
  /** User toggle: hide the searching FGS notice. Default on (missing key = shown). */
  private static final String KEY_MONITOR_NOTICE = "monitorNoticeEnabled";
  /** User toggle: "Gate opened" / open-failed pings. Default on. */
  private static final String KEY_GATE_OPEN_NOTICE = "gateOpenNoticeEnabled";
  /** Android Auto home layout. Default false = grid. */
  private static final String KEY_CAR_LIST_LAYOUT = "carListLayout";
  /** In-app language (en/he/ru) so the widget matches JS, not only the system. */
  private static final String KEY_APP_LANG = "appLang";
  private static final String KEY_WIDGET_LAST_CLOSEST = "widgetLastClosest";
  private static final String KEY_WIDGET_STATUS = "widgetStatus";
  private static final String KEY_WIDGET_STATUS_MSG = "widgetStatusMsg";
  /** Last lat/lng for widget face only — not a fused request. */
  private static final String KEY_WIDGET_LAST_LAT = "widgetLastLat";
  private static final String KEY_WIDGET_LAST_LNG = "widgetLastLng";
  private static final String KEY_WIDGET_LAST_FIX_AT = "widgetLastFixAt";
  private static final String KEY_LAST_RUN_AT = "lastRunAt";
  private static final String KEY_MONITOR_CHECK_AT = "monitorCheckAt";
  private static final String KEY_GEOFENCE_SYNC_AT = "geofenceSyncAt";
  private static final String KEY_SESSION = "sessionToken";
  private static final String KEY_PHONE = "phoneNumber";
  private static final String KEY_TOKEN_TYPE = "tokenType";
  private static final String KEY_GATE_CREDS = "gateCredentialsJson";
  private static final String KEY_EVENTS = "nativeEventsJson";
  private static final String KEY_BURST_COUNT = "burstCount";
  private static final String KEY_GATE_LOCK_MS = "gateLockMs";
  private static final String KEY_CAR_BT_DEVICES = "carBtConnectedJson";
  private static final String KEY_CAR_BT_SEEDED_AT = "carBtSeededAt";
  private static final int MAX_NATIVE_EVENTS = 40;
  private static final int MIN_BURST_COUNT = 3;
  private static final int MAX_BURST_COUNT = 20;
  private static final int DEFAULT_BURST_COUNT = 3;
  private static final long MIN_GATE_LOCK_MS = 5L * 60L * 1000L;
  private static final long MAX_GATE_LOCK_MS = 120L * 60L * 1000L;
  private static final long DEFAULT_GATE_LOCK_MS = 15L * 60L * 1000L;
  private static final Set<String> IN_FLIGHT = new HashSet<>();
  private static volatile long geofenceSyncAtMem;
  private static volatile long monitorCheckAtMem;

  private KeepAlivePrefs() {}

  public static void setArmed(Context context, boolean armed) {
    prefs(context).edit().putBoolean(KEY_ARMED, armed).commit();
  }

  public static boolean isArmed(Context context) {
    return prefs(context).getBoolean(KEY_ARMED, false);
  }

  /**
   * Master shade switch. Off hides searching, gate-opened, and (via JS) update
   * notices. Auto-open itself is unchanged.
   */
  public static void setNoticesEnabled(Context context, boolean enabled) {
    prefs(context).edit().putBoolean(KEY_NOTICES, enabled).commit();
  }

  public static boolean noticesEnabled(Context context) {
    return prefs(context).getBoolean(KEY_NOTICES, true);
  }

  /**
   * Whether the live searching / monitoring notice may stay in the shade.
   * Does not arm or disarm Auto-open — only the notification.
   */
  public static void setMonitorNoticeEnabled(Context context, boolean enabled) {
    prefs(context).edit().putBoolean(KEY_MONITOR_NOTICE, enabled).commit();
  }

  public static boolean monitorNoticeEnabled(Context context) {
    return prefs(context).getBoolean(KEY_MONITOR_NOTICE, true);
  }

  /** Effective searching-notice visibility (master AND the searching toggle). */
  public static boolean monitorNoticeVisible(Context context) {
    return noticesEnabled(context) && monitorNoticeEnabled(context);
  }

  public static void setGateOpenNoticeEnabled(Context context, boolean enabled) {
    prefs(context).edit().putBoolean(KEY_GATE_OPEN_NOTICE, enabled).commit();
  }

  public static boolean gateOpenNoticeEnabled(Context context) {
    return prefs(context).getBoolean(KEY_GATE_OPEN_NOTICE, true);
  }

  /** Effective "Gate opened" ping (master AND the gate-open toggle). */
  public static boolean gateOpenNoticeVisible(Context context) {
    return noticesEnabled(context) && gateOpenNoticeEnabled(context);
  }

  /** Android Auto home: false = grid (default), true = list. */
  public static boolean isCarListLayout(Context context) {
    return prefs(context).getBoolean(KEY_CAR_LIST_LAYOUT, false);
  }

  public static void setCarListLayout(Context context, boolean list) {
    prefs(context).edit().putBoolean(KEY_CAR_LIST_LAYOUT, list).commit();
  }

  public static void setAppLang(Context context, String lang) {
    String value = lang == null ? "" : lang.trim();
    prefs(context).edit().putString(KEY_APP_LANG, value).commit();
  }

  public static String appLang(Context context) {
    String raw = prefs(context).getString(KEY_APP_LANG, "");
    return raw == null ? "" : raw.trim();
  }

  public static void setWidgetLastClosest(Context context, String gateId) {
    prefs(context)
      .edit()
      .putString(KEY_WIDGET_LAST_CLOSEST, gateId == null ? "" : gateId.trim())
      .apply();
  }

  public static String widgetLastClosest(Context context) {
    String raw = prefs(context).getString(KEY_WIDGET_LAST_CLOSEST, "");
    return raw == null ? "" : raw.trim();
  }

  public static void setWidgetStatus(Context context, String status, String message) {
    prefs(context)
      .edit()
      .putString(KEY_WIDGET_STATUS, status == null ? "idle" : status)
      .putString(KEY_WIDGET_STATUS_MSG, message == null ? "" : message)
      .commit();
  }

  public static String widgetStatus(Context context) {
    String raw = prefs(context).getString(KEY_WIDGET_STATUS, "idle");
    return raw == null || raw.isEmpty() ? "idle" : raw;
  }

  public static String widgetStatusMsg(Context context) {
    String raw = prefs(context).getString(KEY_WIDGET_STATUS_MSG, "");
    return raw == null ? "" : raw;
  }

  /**
   * Persist a widget display fix. Callers must already have the Location
   * (MonitoringService callback or tap {@code requestCurrentOrLast}). Never
   * fetch fused from here.
   */
  public static void setWidgetLastFix(Context context, double lat, double lng, long atMs) {
    if (!Double.isFinite(lat) || !Double.isFinite(lng)) return;
    prefs(context)
      .edit()
      .putString(KEY_WIDGET_LAST_LAT, Double.toString(lat))
      .putString(KEY_WIDGET_LAST_LNG, Double.toString(lng))
      .putLong(KEY_WIDGET_LAST_FIX_AT, atMs > 0 ? atMs : System.currentTimeMillis())
      .apply();
  }

  /** Cached widget fix, or null. Reconstructs a Location — does not query Play. */
  public static Location widgetLastFix(Context context) {
    String latS = prefs(context).getString(KEY_WIDGET_LAST_LAT, "");
    String lngS = prefs(context).getString(KEY_WIDGET_LAST_LNG, "");
    if (latS == null || latS.isEmpty() || lngS == null || lngS.isEmpty()) return null;
    try {
      double lat = Double.parseDouble(latS);
      double lng = Double.parseDouble(lngS);
      if (!Double.isFinite(lat) || !Double.isFinite(lng)) return null;
      Location loc = new Location("widget-cache");
      loc.setLatitude(lat);
      loc.setLongitude(lng);
      long at = prefs(context).getLong(KEY_WIDGET_LAST_FIX_AT, 0L);
      if (at > 0) loc.setTime(at);
      return loc;
    } catch (Exception e) {
      return null;
    }
  }

  public static void markRun(Context context) {
    prefs(context).edit().putLong(KEY_LAST_RUN_AT, System.currentTimeMillis()).apply();
  }

  public static long lastRunAt(Context context) {
    return prefs(context).getLong(KEY_LAST_RUN_AT, 0L);
  }

  /**
   * A monitoring check just ran (location tick / native poll). Only feeds the
   * live text of the monitoring notice — nothing schedules off this.
   */
  public static void markMonitorCheck(Context context) {
    monitorCheckAtMem = System.currentTimeMillis();
    prefs(context).edit().putLong(KEY_MONITOR_CHECK_AT, monitorCheckAtMem).apply();
  }

  public static long lastMonitorCheckAt(Context context) {
    return Math.max(monitorCheckAtMem, prefs(context).getLong(KEY_MONITOR_CHECK_AT, 0L));
  }

  /** Disarm: drop the stale age so a later re-arm starts at "starting…". */
  public static void clearMonitorCheck(Context context) {
    monitorCheckAtMem = 0L;
    prefs(context).edit().remove(KEY_MONITOR_CHECK_AT).apply();
  }

  public static void markGeofenceSync(Context context) {
    long now = System.currentTimeMillis();
    geofenceSyncAtMem = now;
    prefs(context).edit().putLong(KEY_GEOFENCE_SYNC_AT, now).commit();
  }

  public static long lastGeofenceSyncAt(Context context) {
    return Math.max(geofenceSyncAtMem, prefs(context).getLong(KEY_GEOFENCE_SYNC_AT, 0L));
  }

  /**
   * Optional already-inside mark (ENTER / poll / BT). EXIT no longer requires
   * this. Still useful for logging. Open itself uses the user radius, not this
   * mark and not the 250m city cap.
   */
  public static boolean isInside(Context context, String gateId) {
    if (gateId == null || gateId.isEmpty()) return false;
    return prefs(context).getBoolean("inside:" + gateId, false);
  }

  public static void setInside(Context context, String gateId, boolean inside) {
    if (gateId == null || gateId.isEmpty()) return;
    String key = "inside:" + gateId;
    if (inside) {
      prefs(context).edit().putBoolean(key, true).apply();
    } else {
      prefs(context).edit().remove(key).apply();
    }
  }

  public static void clearAllInside(Context context) {
    SharedPreferences p = prefs(context);
    SharedPreferences.Editor ed = p.edit();
    boolean any = false;
    for (String k : p.getAll().keySet()) {
      if (k != null && k.startsWith("inside:")) {
        ed.remove(k);
        any = true;
      }
    }
    if (any) ed.apply();
  }

  /**
   * Last known connected car Bluetooth devices, so a cold-started process can
   * answer "is the car connected?" instantly instead of blocking an open on an
   * async profile read. {@code seededAt} is the time of the last <em>complete</em>
   * profile read, or 0 when the set has never been fully read — see
   * {@link CarBluetoothState}.
   */
  public static void setCarBtSnapshot(Context context, String json, long seededAt) {
    prefs(context)
      .edit()
      .putString(KEY_CAR_BT_DEVICES, json == null || json.trim().isEmpty() ? "[]" : json)
      .putLong(KEY_CAR_BT_SEEDED_AT, seededAt)
      .apply();
  }

  public static String carBtSnapshotJson(Context context) {
    String raw = prefs(context).getString(KEY_CAR_BT_DEVICES, "[]");
    return raw == null || raw.trim().isEmpty() ? "[]" : raw;
  }

  public static long carBtSnapshotAt(Context context) {
    return prefs(context).getLong(KEY_CAR_BT_SEEDED_AT, 0L);
  }

  public static void clearCarBtSnapshot(Context context) {
    prefs(context)
      .edit()
      .remove(KEY_CAR_BT_DEVICES)
      .remove(KEY_CAR_BT_SEEDED_AT)
      .apply();
  }

  public static void setCredentials(
    Context context,
    String sessionToken,
    long phoneNumber,
    int tokenType
  ) {
    prefs(context)
      .edit()
      .putString(KEY_SESSION, sessionToken == null ? "" : sessionToken)
      .putLong(KEY_PHONE, phoneNumber)
      .putInt(KEY_TOKEN_TYPE, tokenType)
      .commit();
  }

  public static void clearCredentials(Context context) {
    prefs(context)
      .edit()
      .remove(KEY_SESSION)
      .remove(KEY_PHONE)
      .remove(KEY_TOKEN_TYPE)
      .commit();
  }

  public static void setGateCredentialsJson(Context context, String json) {
    prefs(context)
      .edit()
      .putString(KEY_GATE_CREDS, json == null || json.trim().isEmpty() ? "{}" : json)
      .commit();
  }

  private static JSONObject gateCredsRow(Context context, String gateId) {
    if (gateId == null || gateId.isEmpty()) return null;
    try {
      JSONObject map = new JSONObject(prefs(context).getString(KEY_GATE_CREDS, "{}"));
      return map.optJSONObject(gateId);
    } catch (Exception e) {
      return null;
    }
  }

  public static String sessionTokenForGate(Context context, String gateId) {
    JSONObject row = gateCredsRow(context, gateId);
    if (row != null) {
      String t = row.optString("sessionToken", "");
      if (t != null && t.trim().length() >= 32) return t;
    }
    return sessionToken(context);
  }

  public static long phoneNumberForGate(Context context, String gateId) {
    JSONObject row = gateCredsRow(context, gateId);
    if (row != null && row.has("phoneNumber")) {
      long n = row.optLong("phoneNumber", 0L);
      if (n > 0) return n;
    }
    return phoneNumber(context);
  }

  public static int tokenTypeForGate(Context context, String gateId) {
    JSONObject row = gateCredsRow(context, gateId);
    if (row != null && row.has("tokenType")) {
      return row.optInt("tokenType", tokenType(context));
    }
    return tokenType(context);
  }

  public static boolean hasCredentialsForGate(Context context, String gateId) {
    String token = sessionTokenForGate(context, gateId);
    return token != null && token.trim().length() >= 32 && phoneNumberForGate(context, gateId) > 0;
  }

  public static String sessionToken(Context context) {
    return prefs(context).getString(KEY_SESSION, "");
  }

  public static long phoneNumber(Context context) {
    return prefs(context).getLong(KEY_PHONE, 0L);
  }

  public static int tokenType(Context context) {
    return prefs(context).getInt(KEY_TOKEN_TYPE, 2);
  }

  public static boolean hasCredentials(Context context) {
    String token = sessionToken(context);
    if (token != null && token.trim().length() >= 32 && phoneNumber(context) > 0) {
      return true;
    }
    try {
      JSONObject map = new JSONObject(prefs(context).getString(KEY_GATE_CREDS, "{}"));
      return map.length() > 0;
    } catch (Exception e) {
      return false;
    }
  }

  public static long lastOpenedAt(Context context, String gateId) {
    if (gateId == null || gateId.isEmpty()) return 0L;
    return prefs(context).getLong("opened:" + gateId, 0L);
  }

  public static void setLastOpenedAt(Context context, String gateId, long ts) {
    if (gateId == null || gateId.isEmpty()) return;
    prefs(context).edit().putLong("opened:" + gateId, ts).apply();
  }

  public static long holdUntil(Context context, String deviceId) {
    if (deviceId == null || deviceId.isEmpty()) return 0L;
    return prefs(context).getLong("holdUntil:" + deviceId, 0L);
  }

  public static void setHoldUntil(Context context, String deviceId, long ts) {
    if (deviceId == null || deviceId.isEmpty()) return;
    prefs(context).edit().putLong("holdUntil:" + deviceId, ts).commit();
  }

  public static boolean isHoldActive(Context context, String deviceId) {
    return holdUntil(context, deviceId) > System.currentTimeMillis();
  }

  public static String holdGateId(Context context, String deviceId) {
    if (deviceId == null || deviceId.isEmpty()) return "";
    return prefs(context).getString("holdGate:" + deviceId, "");
  }

  public static void setHoldGateId(Context context, String deviceId, String gateId) {
    if (deviceId == null || deviceId.isEmpty()) return;
    prefs(context)
      .edit()
      .putString("holdGate:" + deviceId, gateId == null ? "" : gateId)
      .apply();
  }

  public static long lastHoldPulseAt(Context context, String deviceId) {
    if (deviceId == null || deviceId.isEmpty()) return 0L;
    return prefs(context).getLong("holdPulse:" + deviceId, 0L);
  }

  public static void setLastHoldPulseAt(Context context, String deviceId, long ts) {
    if (deviceId == null || deviceId.isEmpty()) return;
    prefs(context).edit().putLong("holdPulse:" + deviceId, ts).apply();
  }

  public static void clearHold(Context context, String deviceId) {
    if (deviceId == null || deviceId.isEmpty()) return;
    prefs(context)
      .edit()
      .remove("holdUntil:" + deviceId)
      .remove("holdGate:" + deviceId)
      .remove("holdPulse:" + deviceId)
      .apply();
  }

  public static void clearAllHolds(Context context) {
    SharedPreferences p = prefs(context);
    SharedPreferences.Editor ed = p.edit();
    boolean any = false;
    for (String k : p.getAll().keySet()) {
      if (k != null
        && (k.startsWith("holdUntil:")
          || k.startsWith("holdGate:")
          || k.startsWith("holdPulse:"))) {
        ed.remove(k);
        any = true;
      }
    }
    if (any) ed.apply();
  }

  public static long lockUntil(Context context, String gateId) {
    if (gateId == null || gateId.isEmpty()) return 0L;
    return prefs(context).getLong("lock:" + gateId, 0L);
  }

  public static void setLockUntil(Context context, String gateId, long ts) {
    if (gateId == null || gateId.isEmpty()) return;
    prefs(context).edit().putLong("lock:" + gateId, ts).apply();
  }

  public static String burstCsv(Context context, String gateId) {
    if (gateId == null || gateId.isEmpty()) return "";
    return prefs(context).getString("burst:" + gateId, "");
  }

  public static void setBurstCsv(Context context, String gateId, String csv) {
    if (gateId == null || gateId.isEmpty()) return;
    prefs(context).edit().putString("burst:" + gateId, csv == null ? "" : csv).apply();
  }

  public static synchronized boolean tryClaimOpen(
    Context context,
    String gateId,
    long cooldownMs
  ) {
    if (gateId == null || gateId.isEmpty()) return false;
    long now = System.currentTimeMillis();
    long lock = lockUntil(context, gateId);
    if (lock > now) return false;
    JSONObject gate = GeofenceRegistrar.gateById(context, gateId);
    String deviceId =
      gate != null ? gate.optString("deviceId", gateId).trim() : gateId;
    if (deviceId.isEmpty()) deviceId = gateId;
    long holdUntilMs = holdUntil(context, deviceId);
    long last = lastOpenedAt(context, gateId);
    long cooldownStart = Math.max(last, holdUntilMs);
    if (holdUntilMs <= now) {
      if (cooldownMs > 0 && cooldownStart > 0 && now - cooldownStart < cooldownMs) {
        return false;
      }
    }
    if (!IN_FLIGHT.add(gateId)) return false;
    return true;
  }

  /** Why {@link #tryClaimOpen} would fail — cooldown vs safety lock vs other. */
  public static String peekOpenBlockReason(
    Context context,
    String gateId,
    long cooldownMs
  ) {
    if (gateId == null || gateId.isEmpty()) return "other";
    long now = System.currentTimeMillis();
    if (lockUntil(context, gateId) > now) return "safety_lock";
    JSONObject gate = GeofenceRegistrar.gateById(context, gateId);
    String deviceId =
      gate != null ? gate.optString("deviceId", gateId).trim() : gateId;
    if (deviceId.isEmpty()) deviceId = gateId;
    long holdUntilMs = holdUntil(context, deviceId);
    long last = lastOpenedAt(context, gateId);
    long cooldownStart = Math.max(last, holdUntilMs);
    if (holdUntilMs <= now) {
      if (cooldownMs > 0 && cooldownStart > 0 && now - cooldownStart < cooldownMs) {
        return "cooldown";
      }
    }
    if (IN_FLIGHT.contains(gateId)) return "other";
    return "other";
  }

  public static int burstCount(Context context) {
    int n = prefs(context).getInt(KEY_BURST_COUNT, DEFAULT_BURST_COUNT);
    if (n < MIN_BURST_COUNT) return MIN_BURST_COUNT;
    if (n > MAX_BURST_COUNT) return MAX_BURST_COUNT;
    return n;
  }

  public static long gateLockMs(Context context) {
    long ms = prefs(context).getLong(KEY_GATE_LOCK_MS, DEFAULT_GATE_LOCK_MS);
    if (ms < MIN_GATE_LOCK_MS) return MIN_GATE_LOCK_MS;
    if (ms > MAX_GATE_LOCK_MS) return MAX_GATE_LOCK_MS;
    return ms;
  }

  public static void setSafetyLockSettings(Context context, int burstCount, long gateLockMs) {
    int n = burstCount;
    if (n < MIN_BURST_COUNT) n = MIN_BURST_COUNT;
    if (n > MAX_BURST_COUNT) n = MAX_BURST_COUNT;
    long ms = gateLockMs;
    if (ms < MIN_GATE_LOCK_MS) ms = MIN_GATE_LOCK_MS;
    if (ms > MAX_GATE_LOCK_MS) ms = MAX_GATE_LOCK_MS;
    prefs(context).edit().putInt(KEY_BURST_COUNT, n).putLong(KEY_GATE_LOCK_MS, ms).apply();
  }

  /** @return true if this auto-open newly engaged the safety lock */
  public static synchronized boolean markOpened(Context context, String gateId) {
    if (gateId == null || gateId.isEmpty()) return false;
    long now = System.currentTimeMillis();
    setLastOpenedAt(context, gateId, now);
    boolean engaged = applyBurst(context, gateId, now);
    IN_FLIGHT.remove(gateId);
    return engaged;
  }

  public static synchronized void releaseClaim(String gateId) {
    if (gateId == null) return;
    IN_FLIGHT.remove(gateId);
  }

  /**
   * Queue an auto-open for the in-app Monitoring log. JS drains this on resume
   * (native opens do not run appendEvent themselves).
   */
  public static synchronized void appendNativeEvent(
    Context context,
    String kind,
    String gateId,
    String message,
    String trigger,
    long ts
  ) {
    appendNativeEvent(context, kind, gateId, message, trigger, ts, null);
  }

  public static synchronized void appendNativeEvent(
    Context context,
    String kind,
    String gateId,
    String message,
    String trigger,
    long ts,
    Double distanceM
  ) {
    try {
      JSONArray prev = new JSONArray(prefs(context).getString(KEY_EVENTS, "[]"));
      JSONObject o = new JSONObject();
      o.put("kind", kind == null ? "poll_open" : kind);
      o.put("gateId", gateId == null ? "" : gateId);
      o.put("message", message == null ? "" : message);
      o.put("trigger", trigger == null ? "poll" : trigger);
      o.put("ts", ts > 0 ? ts : System.currentTimeMillis());
      if (distanceM != null && Double.isFinite(distanceM)) {
        o.put("distanceM", distanceM);
      }
      JSONArray next = new JSONArray();
      next.put(o);
      for (int i = 0; i < prev.length() && next.length() < MAX_NATIVE_EVENTS; i++) {
        next.put(prev.get(i));
      }
      prefs(context).edit().putString(KEY_EVENTS, next.toString()).commit();
    } catch (Exception ignored) {
      // ignore
    }
  }

  public static synchronized String drainNativeEvents(Context context) {
    String raw = prefs(context).getString(KEY_EVENTS, "[]");
    prefs(context).edit().remove(KEY_EVENTS).commit();
    return raw == null || raw.trim().isEmpty() ? "[]" : raw;
  }

  /** Active per-gate auto safety locks for the in-app banner/row. */
  public static String safetyLocksJson(Context context) {
    JSONArray arr = new JSONArray();
    long now = System.currentTimeMillis();
    try {
      Map<String, ?> all = prefs(context).getAll();
      for (Map.Entry<String, ?> e : all.entrySet()) {
        String k = e.getKey();
        if (k == null || !k.startsWith("lock:")) continue;
        Object v = e.getValue();
        long until = 0L;
        if (v instanceof Long) until = (Long) v;
        else if (v instanceof Integer) until = ((Integer) v).longValue();
        if (until <= now) continue;
        JSONObject o = new JSONObject();
        o.put("gateId", k.substring("lock:".length()));
        o.put("lockUntil", until);
        arr.put(o);
      }
    } catch (Exception ignored) {
      // ignore
    }
    return arr.toString();
  }

  public static void clearSafetyLocks(Context context) {
    SharedPreferences p = prefs(context);
    SharedPreferences.Editor ed = p.edit();
    for (String k : p.getAll().keySet()) {
      if (k != null && (k.startsWith("lock:") || k.startsWith("burst:"))) {
        ed.remove(k);
      }
    }
    ed.apply();
  }

  private static final long BURST_WINDOW_MS = 2 * 60 * 1000L;

  /** @return true if this open newly engaged the safety lock */
  private static boolean applyBurst(Context context, String gateId, long now) {
    String csv = burstCsv(context, gateId);
    StringBuilder next = new StringBuilder();
    int count = 0;
    if (csv != null && !csv.isEmpty()) {
      for (String part : csv.split(",")) {
        try {
          long ts = Long.parseLong(part.trim());
          if (now - ts <= BURST_WINDOW_MS) {
            if (next.length() > 0) next.append(',');
            next.append(ts);
            count++;
          }
        } catch (NumberFormatException ignored) {
          // skip
        }
      }
    }
    if (next.length() > 0) next.append(',');
    next.append(now);
    count++;
    setBurstCsv(context, gateId, next.toString());
    int limit = burstCount(context);
    if (count >= limit) {
      long existing = lockUntil(context, gateId);
      if (existing <= now) {
        setLockUntil(context, gateId, now + gateLockMs(context));
        return true;
      }
    }
    return false;
  }

  static SharedPreferences prefs(Context context) {
    return context.getApplicationContext().getSharedPreferences(PREF, Context.MODE_PRIVATE);
  }
}
