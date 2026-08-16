package com.gateauto.app.keepalive;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.Set;

/** Native mirror of JS monitoring-enabled, credentials, and last-open times. */
public final class KeepAlivePrefs {
  private static final String PREF = "gateauto_keepalive";
  private static final String KEY_ARMED = "armed";
  private static final String KEY_LAST_RUN_AT = "lastRunAt";
  private static final String KEY_SESSION = "sessionToken";
  private static final String KEY_PHONE = "phoneNumber";
  private static final String KEY_TOKEN_TYPE = "tokenType";
  private static final String KEY_EVENTS = "nativeEventsJson";
  private static final int MAX_NATIVE_EVENTS = 40;
  private static final Set<String> IN_FLIGHT = new HashSet<>();

  private KeepAlivePrefs() {}

  public static void setArmed(Context context, boolean armed) {
    prefs(context).edit().putBoolean(KEY_ARMED, armed).apply();
  }

  public static boolean isArmed(Context context) {
    return prefs(context).getBoolean(KEY_ARMED, false);
  }

  public static void markRun(Context context) {
    prefs(context).edit().putLong(KEY_LAST_RUN_AT, System.currentTimeMillis()).apply();
  }

  public static long lastRunAt(Context context) {
    return prefs(context).getLong(KEY_LAST_RUN_AT, 0L);
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
      .apply();
  }

  public static void clearCredentials(Context context) {
    prefs(context)
      .edit()
      .remove(KEY_SESSION)
      .remove(KEY_PHONE)
      .remove(KEY_TOKEN_TYPE)
      .apply();
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
    return token != null && token.trim().length() >= 32 && phoneNumber(context) > 0;
  }

  public static long lastOpenedAt(Context context, String gateId) {
    if (gateId == null || gateId.isEmpty()) return 0L;
    return prefs(context).getLong("opened:" + gateId, 0L);
  }

  public static void setLastOpenedAt(Context context, String gateId, long ts) {
    if (gateId == null || gateId.isEmpty()) return;
    prefs(context).edit().putLong("opened:" + gateId, ts).apply();
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
    long last = lastOpenedAt(context, gateId);
    if (cooldownMs > 0 && last > 0 && now - last < cooldownMs) return false;
    if (!IN_FLIGHT.add(gateId)) return false;
    return true;
  }

  public static synchronized void markOpened(Context context, String gateId) {
    if (gateId == null || gateId.isEmpty()) return;
    long now = System.currentTimeMillis();
    setLastOpenedAt(context, gateId, now);
    applyBurst(context, gateId, now);
    IN_FLIGHT.remove(gateId);
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
    try {
      JSONArray prev = new JSONArray(prefs(context).getString(KEY_EVENTS, "[]"));
      JSONObject o = new JSONObject();
      o.put("kind", kind == null ? "poll_open" : kind);
      o.put("gateId", gateId == null ? "" : gateId);
      o.put("message", message == null ? "" : message);
      o.put("trigger", trigger == null ? "poll" : trigger);
      o.put("ts", ts > 0 ? ts : System.currentTimeMillis());
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

  private static final int BURST_COUNT = 4;
  private static final long BURST_WINDOW_MS = 2 * 60 * 1000L;
  private static final long GATE_LOCK_MS = 40 * 60 * 1000L;

  private static void applyBurst(Context context, String gateId, long now) {
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
    if (count >= BURST_COUNT) {
      long existing = lockUntil(context, gateId);
      if (existing <= now) {
        setLockUntil(context, gateId, now + GATE_LOCK_MS);
      }
    }
  }

  static SharedPreferences prefs(Context context) {
    return context.getApplicationContext().getSharedPreferences(PREF, Context.MODE_PRIVATE);
  }
}
