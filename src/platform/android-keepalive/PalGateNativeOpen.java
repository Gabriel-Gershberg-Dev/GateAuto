package com.gateauto.app.keepalive;

import android.app.ActivityManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.location.Location;
import android.os.Build;
import android.os.SystemClock;
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
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
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
  /**
   * Short timeouts + one connect retry so a cold LTE re-attach cannot silently
   * stall the open for ~10s. Read phase is never retried (request already sent).
   */
  private static final int CONNECT_TIMEOUT_MS = 6_000;
  private static final int READ_TIMEOUT_MS = 8_000;
  private static final int OPEN_MAX_ATTEMPTS = 2;
  private static final double ABSOLUTE_MAX_M = 250.0;
  private static final long HOLD_MAX_MS = 90_000L;
  private static final long HOLD_PULSE_MIN_MS = 5_000L;
  private static final long HOLD_PULSE_MAX_MS = 8_000L;
  /**
   * Swallow Play EXIT that arrives immediately after Off→On remove+add.
   * Alarm/recover refresh must not mark this window (that swallowed real enters).
   */
  private static final long GEOFENCE_SYNC_SUPPRESS_MS = 12_000L;
  /**
   * A Play ENTER/EXIT that fired but resolved just OUTSIDE the (often tight)
   * user radius. {@link #onFenceWake} takes a fresh High GPS sample, polls every
   * nearby gate, then {@link ApproachSampler} watches at 1 Hz until the fix is
   * inside the user's radius (or we leave / time out). Open stays ≤ user radius.
   */
  private static final long FRESH_LOC_MAX_AGE_MS = 8_000L;
  private static final long CURRENT_LOC_TIMEOUT_S = 6L;
  private static final long SKIP_LOG_MIN_MS = 10_000L;
  /** Far poll skip rows (in-app log). Same 5 min as JS POLL_FAR_LOG_MIN_MS. */
  private static final long POLL_CHECK_FAR_MS = 5L * 60_000L;
  /** Near / BT skip rows so the Monitoring log is not JS-only. */
  private static final long POLL_CHECK_NEAR_MS = 60_000L;
  private static final Map<String, Long> lastPollCheckAt = new ConcurrentHashMap<>();
  private static final String NOTIF_CHANNEL = "gateauto";

  private PalGateNativeOpen() {}

  /**
   * Deliberate open from Android Auto (same as in-app Manual Open): credentials +
   * deviceId required; no geofence, BT, cooldown, or auto safety lock.
   *
   * @return null on success, otherwise a short error for CarToast
   */
  public static String openManual(Context context, String gateId) {
    return openManual(context, gateId, "manual");
  }

  /**
   * Deliberate open (Android Auto, home widget). No geofence, BT, cooldown, or
   * auto safety lock. {@code source} is telemetry only — default {@code manual}.
   */
  public static String openManual(Context context, String gateId, String source) {
    JSONObject gate = GeofenceRegistrar.gateById(context, gateId);
    if (gate == null) return "Unknown gate";
    String deviceId = gate.optString("deviceId", "").trim();
    if (deviceId.isEmpty()) return "Missing deviceId";
    if (!KeepAlivePrefs.hasCredentialsForGate(context, gateId)) return "Not linked to PalGate";
    String src = source == null || source.trim().isEmpty() ? "manual" : source.trim();
    try {
      httpOpen(context, deviceId, gateId);
      // Record last-open for auto cooldown, but do not applyBurst (auto-only lock).
      KeepAlivePrefs.setLastOpenedAt(context, gateId, System.currentTimeMillis());
      notifyOpened(context, GeofenceRegistrar.displayLabel(gate));
      GateAutoTelemetry.autoOpen(context, src, gateId, null, gate);
      Log.i(TAG, "native " + src + " open OK " + gateId + " " + deviceId);
      return null;
    } catch (Exception e) {
      Log.w(TAG, "native " + src + " open failed " + gateId, e);
      GateAutoTelemetry.autoSkip(context, "other", src, gateId, null, gate);
      if (!isExpectedOpenFailure(e)) {
        GateAutoTelemetry.recordUnexpected(e);
      }
      String msg = e.getMessage();
      return msg == null || msg.trim().isEmpty() ? "Open failed" : msg;
    }
  }

  /** Last fused fix. May block up to 4s. Do not call on the main thread. */
  public static Location peekLastLocation(Context context) {
    return lastLocation(context);
  }

  /** User-initiated: prefer a current fix, else last. May block ~6s. */
  public static Location requestCurrentOrLast(Context context) {
    Location fresh = currentLocation(context, true);
    if (fresh != null) return fresh;
    return lastLocation(context);
  }

  public static void openFromGeofence(Context context, String gateId, String reason) {
    openFromGeofence(context, gateId, reason, null);
  }

  public static void openFromGeofence(
    Context context,
    String gateId,
    String reason,
    Location triggering
  ) {
    openFromGeofence(context, gateId, reason, triggering, -1L, null);
  }

  /**
   * Play ENTER/EXIT. {@code triggering} is Play's geofence fix when present —
   * prefer it when it is inside the configured radius. Last loc is only
   * consulted if triggering is missing or outside. Both outside / both missing
   * → skip. 250m is a city-garbage cap, not the open threshold.
   *
   * @param startElapsed SystemClock.elapsedRealtime() at broadcast receipt, or
   *     ≤0 when unmeasured. Threaded into auto_open telemetry as latency_ms so
   *     cold-wake open latency is measurable.
   * @param warm 1 if a location FGS was already alive when the fence fired,
   *     else 0 (cold process). null when unknown.
   */
  public static void openFromGeofence(
    Context context,
    String gateId,
    String reason,
    Location triggering,
    long startElapsed,
    Boolean warm
  ) {
    JSONObject gate = GeofenceRegistrar.gateById(context, gateId);
    if (gate == null) {
      Log.w(TAG, "native open: unknown gate " + gateId);
      return;
    }
    boolean isExit = "exit".equals(reason);
    if (!GeofenceRegistrar.isAutoEnabled(gate)) {
      Log.i(TAG, "native open skip " + gateId + " — auto-open off (stale fence)");
      KeepAlivePrefs.setInside(context, gateId, false);
      GateAutoTelemetry.autoSkip(
        context,
        "other",
        isExit ? "play_exit" : "play_enter",
        gateId,
        null,
        gate
      );
      return;
    }
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
        GateAutoTelemetry.autoSkip(context, "other", "play_exit", gateId, null, gate);
        return;
      }
    }
    PlayOpenCheck check = resolvePlayOpen(context, gate, triggering);
    if (!check.ok) {
      String label = GeofenceRegistrar.displayLabel(gate);
      Log.i(TAG, "native open skip " + gateId + " (" + reason + ") — " + check.detail);
      KeepAlivePrefs.appendNativeEvent(
        context,
        "skipped_refine",
        gateId,
        label + ": " + reason.toUpperCase() + " " + check.detail,
        reason,
        System.currentTimeMillis(),
        Double.isFinite(check.meters) ? check.meters : null
      );
      GateAutoTelemetry.autoSkip(
        context,
        "outside_radius",
        isExit ? "play_exit" : "play_enter",
        gateId,
        Double.isFinite(check.meters) ? check.meters : null,
        gate
      );
      // Do not open this gate. onFenceWake (same broadcast) takes a fresh GPS
      // sample and polls every nearby pin — that's how clustered 25m gates next
      // to a 40m pin still open. Rapid retries are scheduled from pollNearby
      // if we're still inside the detect fence.
      return;
    }
    if (isExit) {
      KeepAlivePrefs.setInside(context, gateId, false);
      Log.i(
        TAG,
        "native exit allowed "
          + gateId
          + " "
          + check.source
          + "="
          + String.format(Locale.US, "%.1fm", check.meters)
          + " ≤ radius "
          + String.format(Locale.US, "%.1fm", check.maxM)
      );
    } else {
      KeepAlivePrefs.setInside(context, gateId, true);
      Log.i(
        TAG,
        "native mark inside "
          + gateId
          + " (enter) "
          + check.source
          + "="
          + String.format(Locale.US, "%.1fm", check.meters)
          + " ≤ radius "
          + String.format(Locale.US, "%.1fm", check.maxM)
      );
    }
    if (!bluetoothMatches(context, gate)) {
      Log.i(TAG, "native open skip " + gateId + " — car BT not connected");
      GateAutoTelemetry.autoSkip(
        context,
        "bt_missing",
        isExit ? "play_exit" : "play_enter",
        gateId,
        Double.isFinite(check.meters) ? check.meters : null,
        gate
      );
      return;
    }
    openGateObject(
      context,
      gate,
      reason,
      check.meters,
      isExit ? "play_exit" : "play_enter",
      startElapsed,
      warm
    );
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
      if (last == null || !withinFence(gate, last, 1.0)) {
        double meters = last == null ? Double.NaN : distanceMeters(gate, last);
        double maxM = openMaxMeters(gate);
        Log.i(
          TAG,
          "native BT skip "
            + gate.optString("id")
            + " — not near pin ("
            + (Double.isFinite(meters)
              ? String.format(Locale.US, "%.1fm > radius %.1fm", meters, maxM)
              : "no loc")
            + ")"
        );
        GateAutoTelemetry.autoSkip(
          context,
          "outside_radius",
          "bt",
          gate.optString("id"),
          Double.isFinite(meters) ? meters : null,
          gate
        );
        continue;
      }
      KeepAlivePrefs.setInside(context, gate.optString("id"), true);
      openGateObject(context, gate, "bt", distanceMeters(gate, last), "bt");
    }
  }

  /**
   * Recover / cooldown: open auto-enabled gates whose loc is inside the pin
   * radius (Samsung often never delivers ENTER while locked). Edge of radius
   * is the desired first open — do not wait to get closer. Guards: armed,
   * last loc present, within configured radius (250m is garbage cap only),
   * cooldown/safety lock, credentials. BT-required: listed car currently
   * connected — not any HID. Never starts a location FGS (Android 12+ blocks
   * that from this receiver).
   */
  public static void pollNearby(Context context) {
    pollNearby(context, "poll", null);
  }

  public static void pollNearby(Context context, String analyticsSource) {
    pollNearby(context, analyticsSource, null);
  }

  /**
   * After a Play ENTER/EXIT (any gate). Takes a fresh High GPS sample — locked
   * phones otherwise keep recycling a stale last-loc — then polls EVERY nearby
   * gate so a 40m pin waking the process also opens clustered 25m pins.
   */
  public static void onFenceWake(Context context, Location triggering) {
    Location fresh = currentLocation(context, true);
    Location loc = fresh != null ? fresh : triggering;
    if (loc != null) {
      Log.i(
        TAG,
        "native fence-wake loc="
          + (fresh != null ? "fresh" : "triggering")
          + " age="
          + locAgeMs(loc)
          + "ms"
      );
    }
    pollNearby(context, "poll", loc);
    ApproachSampler.start(context);
  }

  /** True when {@code loc} is inside any armed gate's Play detect fence. */
  public static boolean anyWithinDetect(Context context, Location loc) {
    if (loc == null) return false;
    JSONArray arr = GeofenceRegistrar.regionsArray(context);
    for (int i = 0; i < arr.length(); i++) {
      JSONObject gate = arr.optJSONObject(i);
      if (gate == null || !GeofenceRegistrar.isAutoEnabled(gate)) continue;
      double meters = distanceMeters(gate, loc);
      double detect = GeofenceRegistrar.detectRadiusMeters(gate);
      if (Double.isFinite(meters) && detect > 0 && meters <= detect) return true;
    }
    return false;
  }

  public static void pollNearby(Context context, String analyticsSource, Location provided) {
    String source = "recover".equals(analyticsSource) ? "recover" : "poll";
    if (!KeepAlivePrefs.isArmed(context)) {
      Log.i(TAG, "native poll skip — not armed");
      return;
    }
    // Keep the car-BT proxies bound and the cached device set fresh, so the next
    // open never has to wait for a Bluetooth read. Returns immediately once
    // bound; never blocks this poll.
    CarBluetoothState.prime(context);
    // Presentation only: keeps the monitoring notice's "last check" honest,
    // including while the non-location HoldService is the one holding us.
    KeepAlivePrefs.markMonitorCheck(context);
    MonitoringNotice.update(context);
    JSONArray arr = GeofenceRegistrar.regionsArray(context);
    if (arr == null || arr.length() == 0) {
      Log.w(TAG, "native poll — empty native regions (locked cannot open)");
      return;
    }
    Location last = provided != null ? provided : resolvePollLocation(context);
    if (last == null) {
      maybeLogPollCheck(
        context,
        "_noloc",
        "Auto-open",
        "no last location",
        null,
        true,
        "info",
        source,
        null
      );
      return;
    }
    int auto = 0;
    int inside = 0;
    boolean approaching = false;
    for (int i = 0; i < arr.length(); i++) {
      JSONObject gate = arr.optJSONObject(i);
      if (gate == null) continue;
      if (!GeofenceRegistrar.isAutoEnabled(gate)) continue;
      auto++;
      String id = gate.optString("id", "").trim();
      double meters = distanceMeters(gate, last);
      if (!withinFence(gate, last, 1.0)) {
        double detect = GeofenceRegistrar.detectRadiusMeters(gate);
        if (Double.isFinite(meters) && detect > 0 && meters <= detect) {
          approaching = true;
        }
        String detail =
          Double.isFinite(meters)
            ? String.format(Locale.US, "not inside (%.1fm)", meters)
            : "not inside (no pin)";
        maybeLogSkipLine(id, detail);
        maybeLogPollCheck(
          context,
          id,
          GeofenceRegistrar.displayLabel(gate),
          detail,
          Double.isFinite(meters) ? meters : null,
          true,
          "skipped_refine",
          source,
          gate
        );
        continue;
      }
      inside++;
      if (!id.isEmpty() && !KeepAlivePrefs.isInside(context, id)) {
        Log.i(TAG, "native mark inside " + id + " (poll, already inside — no Play ENTER)");
      }
      if (!id.isEmpty()) KeepAlivePrefs.setInside(context, id, true);
      if (!bluetoothMatches(context, gate)) {
        Log.i(
          TAG,
          "native poll skip "
            + id
            + " — BT-required (listed car not connected; poll is not a car-connect)"
        );
        maybeLogPollCheck(
          context,
          id,
          GeofenceRegistrar.displayLabel(gate),
          "required car Bluetooth not connected",
          Double.isFinite(meters) ? meters : null,
          false,
          "skipped_bt",
          source,
          gate
        );
        continue;
      }
      openGateObject(context, gate, "poll", meters, source);
    }
    if (inside > 0 || !approaching) {
      Log.i(
        TAG,
        "native poll done — regions="
          + arr.length()
          + " auto="
          + auto
          + " inside="
          + inside
          + " approaching="
          + approaching
      );
    }
    if (approaching) {
      ApproachSampler.start(context);
    }
  }

  private static void maybeLogSkipLine(String id, String detail) {
    String key = id == null || id.isEmpty() ? "_unknown" : id;
    long now = System.currentTimeMillis();
    Long last = lastPollCheckAt.get("log:" + key);
    if (last != null && now - last < SKIP_LOG_MIN_MS) return;
    lastPollCheckAt.put("log:" + key, now);
    Log.i(TAG, "native poll skip " + id + " — " + detail);
  }

  private static void openGateObject(
    Context context,
    JSONObject gate,
    String reason,
    double distanceM,
    String analyticsSource
  ) {
    openGateObject(context, gate, reason, distanceM, analyticsSource, -1L, null);
  }

  private static void openGateObject(
    Context context,
    JSONObject gate,
    String reason,
    double distanceM,
    String analyticsSource,
    long startElapsed,
    Boolean warm
  ) {
    String gateId = gate.optString("id", "").trim();
    String deviceId = gate.optString("deviceId", "").trim();
    long cooldownMs = gate.optLong("cooldownMs", 30_000L);
    Double dist = Double.isFinite(distanceM) ? distanceM : null;
    if (gateId.isEmpty() || deviceId.isEmpty()) {
      Log.w(TAG, "native open skip — missing id/deviceId");
      GateAutoTelemetry.autoSkip(context, "other", analyticsSource, gateId, dist, gate);
      return;
    }
    if ("poll".equals(reason) && KeepAlivePrefs.isHoldActive(context, deviceId)) {
      Log.i(
        TAG,
        "native open skip " + gateId + " — hold in progress (poll is not a new ENTER)"
      );
      GateAutoTelemetry.autoSkip(context, "cooldown", analyticsSource, gateId, dist, gate);
      return;
    }
    if (!GeofenceRegistrar.isAutoEnabled(gate)) {
      Log.i(TAG, "native open skip " + gateId + " — auto-open off");
      GateAutoTelemetry.autoSkip(context, "other", analyticsSource, gateId, dist, gate);
      return;
    }
    if (!KeepAlivePrefs.hasCredentialsForGate(context, gateId)) {
      Log.w(TAG, "native open skip — no credentials");
      GateAutoTelemetry.autoSkip(context, "other", analyticsSource, gateId, dist, gate);
      return;
    }
    if (!KeepAlivePrefs.tryClaimOpen(context, gateId, cooldownMs)) {
      String block = KeepAlivePrefs.peekOpenBlockReason(context, gateId, cooldownMs);
      Log.i(TAG, "native open skip " + gateId + " — cooldown/lock/in-flight");
      GateAutoTelemetry.autoSkip(context, block, analyticsSource, gateId, dist, gate);
      return;
    }
    try {
      httpOpen(context, deviceId, gateId);
      boolean lockEngaged = KeepAlivePrefs.markOpened(context, gateId);
      startHoldAfterAutoOpen(context, gate);
      String label = GeofenceRegistrar.displayLabel(gate);
      notifyOpened(context, label);
      long ts = System.currentTimeMillis();
      String distPart =
        dist != null ? " · " + String.format(Locale.US, "%.1fm", dist) : "";
      KeepAlivePrefs.appendNativeEvent(
        context,
        nativeOpenKind(reason),
        gateId,
        label + ": native " + reason + " open" + distPart + " · deviceId " + deviceId,
        nativeOpenTrigger(reason),
        ts,
        dist
      );
      long latencyMs =
        startElapsed > 0 ? SystemClock.elapsedRealtime() - startElapsed : -1L;
      GateAutoTelemetry.autoOpen(context, analyticsSource, gateId, dist, gate, latencyMs, warm);
      if (lockEngaged) {
        KeepAlivePrefs.appendNativeEvent(
          context,
          "safety_lock",
          gateId,
          label
            + ": Safety lock engaged for "
            + Math.max(1L, Math.round(KeepAlivePrefs.gateLockMs(context) / 60_000.0))
            + "m ("
            + KeepAlivePrefs.burstCount(context)
            + " auto-opens in 2m)",
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
          + distPart
      );
    } catch (Exception e) {
      KeepAlivePrefs.releaseClaim(gateId);
      Log.w(TAG, "native open failed " + gateId, e);
      GateAutoTelemetry.autoSkip(context, "other", analyticsSource, gateId, dist, gate);
      if (!isExpectedOpenFailure(e)) {
        GateAutoTelemetry.recordUnexpected(e);
      }
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
    // Retry only the connection-establishment phase. A cold LTE radio can lose
    // the first connect (DNS / TLS on a re-attaching radio); a fast second try
    // usually lands once the radio is up. We never retry after the request has
    // been sent (getResponseCode) so the gate can never be double-opened.
    java.io.IOException lastConnectError = null;
    for (int attempt = 0; attempt < OPEN_MAX_ATTEMPTS; attempt++) {
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
        conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
        conn.setReadTimeout(READ_TIMEOUT_MS);
        conn.setRequestProperty("Accept", "*/*");
        conn.setRequestProperty("Accept-Language", "en-us");
        conn.setRequestProperty("Content-Type", "application/json");
        conn.setRequestProperty("User-Agent", "okhttp/4.9.3");
        conn.setRequestProperty("Cache-Control", "no-cache, no-store");
        conn.setRequestProperty("Pragma", "no-cache");
        conn.setRequestProperty("X-Bt-Token", token);
        try {
          conn.connect();
        } catch (java.io.IOException connErr) {
          lastConnectError = connErr;
          if (attempt + 1 < OPEN_MAX_ATTEMPTS) {
            Log.w(TAG, "open-gate connect failed, retrying once", connErr);
            continue;
          }
          throw connErr;
        }
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
        return;
      } finally {
        conn.disconnect();
      }
    }
    throw lastConnectError != null
      ? lastConnectError
      : new IllegalStateException("open-gate connect failed");
  }

  static long capHoldMs(long ms) {
    if (ms <= 0) return 0L;
    return Math.min(HOLD_MAX_MS, ms);
  }

  static long holdPulseIntervalMs(long holdMs) {
    long ms = capHoldMs(holdMs);
    if (ms <= 0) return 0L;
    long delay = ms / 4L;
    if (delay < HOLD_PULSE_MIN_MS) return HOLD_PULSE_MIN_MS;
    if (delay > HOLD_PULSE_MAX_MS) return HOLD_PULSE_MAX_MS;
    return delay;
  }

  static boolean holdSwitchOn(JSONObject gate) {
    return gate != null && gate.optBoolean("holdEnabled", false);
  }

  public static void startHoldAfterAutoOpen(Context context, JSONObject gate) {
    if (gate == null) return;
    String deviceId = gate.optString("deviceId", "").trim();
    long cooldownMs = gate.optLong("cooldownMs", 30_000L);
    if (cooldownMs < 0) cooldownMs = 0;
    if (deviceId.isEmpty()) return;
    long holdMs = holdSwitchOn(gate) ? capHoldMs(gate.optLong("holdMs", 0L)) : 0L;
    if (holdMs <= 0) {
      KeepAlivePrefs.clearHold(context, deviceId);
      KeepAliveScheduler.cancelHoldPulse(context, deviceId);
      KeepAliveScheduler.scheduleCooldownWake(
        context,
        Math.max(3_000L, cooldownMs + 1_500L)
      );
      return;
    }
    long now = System.currentTimeMillis();
    KeepAlivePrefs.setHoldUntil(context, deviceId, now + holdMs);
    KeepAlivePrefs.setHoldGateId(context, deviceId, gate.optString("id", ""));
    KeepAlivePrefs.setLastHoldPulseAt(context, deviceId, now);
    long interval = holdPulseIntervalMs(holdMs);
    KeepAliveScheduler.scheduleHoldPulse(context, deviceId, interval);
    KeepAliveScheduler.scheduleCooldownWake(
      context,
      holdMs + cooldownMs + 1_500L
    );
    Log.i(
      TAG,
      "hold start " + deviceId + " for " + holdMs + "ms every " + interval + "ms"
    );
  }

  public static void startHoldFromJs(
    Context context,
    String deviceId,
    String gateId,
    long holdMs
  ) {
    JSONObject gate = GeofenceRegistrar.gateById(context, gateId);
    if (gate == null) gate = GeofenceRegistrar.gateByDeviceId(context, deviceId);
    if (gate == null) {
      gate = new JSONObject();
      try {
        gate.put("id", gateId == null || gateId.isEmpty() ? deviceId : gateId);
        gate.put("deviceId", deviceId);
        gate.put("holdEnabled", holdMs > 0);
        gate.put("holdMs", capHoldMs(holdMs));
        gate.put("cooldownMs", 30_000L);
      } catch (Exception ignored) {
        return;
      }
    } else {
      try {
        JSONObject copy = new JSONObject(gate.toString());
        copy.put("holdEnabled", holdMs > 0);
        copy.put("holdMs", capHoldMs(holdMs));
        gate = copy;
      } catch (Exception ignored) {
        // use original
      }
    }
    startHoldAfterAutoOpen(context, gate);
  }

  /**
   * Silent hold pulse: PalGate GET only. No tray, no Monitoring log, no safety
   * lock. Never starts a location FGS.
   */
  public static void pulseHold(Context context, String deviceId) {
    if (deviceId == null || deviceId.trim().isEmpty()) return;
    String id = deviceId.trim();
    long now = System.currentTimeMillis();
    long until = KeepAlivePrefs.holdUntil(context, id);
    if (until <= now) {
      Log.i(TAG, "hold end " + id);
      KeepAlivePrefs.clearHold(context, id);
      return;
    }
    JSONObject gate = GeofenceRegistrar.gateByDeviceId(context, id);
    if (gate == null) {
      String gateId = KeepAlivePrefs.holdGateId(context, id);
      if (!gateId.isEmpty()) gate = GeofenceRegistrar.gateById(context, gateId);
    }
    if (gate == null || !holdSwitchOn(gate)) {
      Log.i(TAG, "hold pulse skip " + id + " — off or unknown gate");
      KeepAlivePrefs.clearHold(context, id);
      KeepAliveScheduler.cancelHoldPulse(context, id);
      return;
    }
    String credGateId = gate.optString("id", id);
    if (!KeepAlivePrefs.hasCredentialsForGate(context, credGateId)) {
      Log.w(TAG, "hold pulse skip — no credentials");
      return;
    }
    long last = KeepAlivePrefs.lastHoldPulseAt(context, id);
    if (last > 0 && now - last < HOLD_PULSE_MIN_MS) {
      KeepAliveScheduler.scheduleHoldPulse(
        context,
        id,
        HOLD_PULSE_MIN_MS - (now - last)
      );
      return;
    }
    String openId = gate.optString("deviceId", id).trim();
    if (openId.isEmpty()) openId = id;
    try {
      httpOpen(context, openId, credGateId);
      KeepAlivePrefs.setLastHoldPulseAt(context, id, System.currentTimeMillis());
      Log.i(TAG, "hold pulse OK " + id + " (silent)");
    } catch (Exception e) {
      Log.w(TAG, "hold pulse failed " + id, e);
    }
    long remaining = until - System.currentTimeMillis();
    if (remaining >= HOLD_PULSE_MIN_MS) {
      long configured = capHoldMs(gate.optLong("holdMs", remaining));
      long interval = holdPulseIntervalMs(configured > 0 ? configured : remaining);
      KeepAliveScheduler.scheduleHoldPulse(
        context,
        id,
        Math.min(interval, remaining)
      );
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

  private static final class PlayOpenCheck {
    final boolean ok;
    final double meters;
    final double maxM;
    final String source;
    final String detail;

    PlayOpenCheck(boolean ok, double meters, double maxM, String source, String detail) {
      this.ok = ok;
      this.meters = meters;
      this.maxM = maxM;
      this.source = source;
      this.detail = detail;
    }
  }

  private static double openMaxMeters(JSONObject gate) {
    double radius = gate.optDouble("radius", Double.NaN);
    if (!(radius > 0) || !Double.isFinite(radius)) return 0;
    return Math.min(radius, ABSOLUTE_MAX_M);
  }

  /**
   * Prefer Play triggering loc if it is ≤ user radius. Fetch fused last only
   * when triggering is missing or outside — do not wait for GPS when already
   * inside. Both outside / both missing → skip (Play ENTER is not an open).
   */
  private static PlayOpenCheck resolvePlayOpen(
    Context context,
    JSONObject gate,
    Location triggering
  ) {
    double maxM = openMaxMeters(gate);
    if (!(maxM > 0)) {
      return new PlayOpenCheck(
        false,
        Double.NaN,
        maxM,
        "none",
        "skipped — missing pin radius"
      );
    }
    if (triggering != null) {
      double trigM = distanceMeters(gate, triggering);
      if (Double.isFinite(trigM) && trigM <= maxM) {
        return new PlayOpenCheck(true, trigM, maxM, "triggering", "");
      }
      Location last = lastLocation(context);
      if (last != null) {
        double lastM = distanceMeters(gate, last);
        if (Double.isFinite(lastM) && lastM <= maxM) {
          return new PlayOpenCheck(true, lastM, maxM, "last", "");
        }
        double closest =
          Double.isFinite(trigM) && (!Double.isFinite(lastM) || trigM <= lastM)
            ? trigM
            : lastM;
        String source =
          Double.isFinite(trigM) && closest == trigM ? "triggering" : "last";
        return playSkip(closest, maxM, source);
      }
      if (Double.isFinite(trigM)) {
        return playSkip(trigM, maxM, "triggering");
      }
    } else {
      Location last = lastLocation(context);
      if (last != null) {
        double lastM = distanceMeters(gate, last);
        if (Double.isFinite(lastM) && lastM <= maxM) {
          return new PlayOpenCheck(true, lastM, maxM, "last", "");
        }
        if (Double.isFinite(lastM)) {
          return playSkip(lastM, maxM, "last");
        }
      }
    }
    return new PlayOpenCheck(
      false,
      Double.NaN,
      maxM,
      "none",
      "skipped — no location (Play ENTER/EXIT is not enough; need fix ≤ radius "
        + String.format(Locale.US, "%.1fm", maxM)
        + ")"
    );
  }

  private static PlayOpenCheck playSkip(double meters, double maxM, String source) {
    boolean city = meters > ABSOLUTE_MAX_M;
    String detail =
      city
        ? "skipped — "
          + source
          + " loc "
          + String.format(Locale.US, "%.1fm", meters)
          + " > "
          + (int) ABSOLUTE_MAX_M
          + "m city cap"
        : "skipped — "
          + source
          + " loc "
          + String.format(Locale.US, "%.1fm", meters)
          + " > radius "
          + String.format(Locale.US, "%.1fm", maxM);
    return new PlayOpenCheck(false, meters, maxM, source, detail);
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

  private static void maybeLogPollCheck(
    Context context,
    String gateId,
    String label,
    String detail,
    Double meters,
    boolean far,
    String kind,
    String analyticsSource,
    JSONObject gate
  ) {
    String key = gateId == null || gateId.isEmpty() ? "_unknown" : gateId;
    long min = far ? POLL_CHECK_FAR_MS : POLL_CHECK_NEAR_MS;
    long now = System.currentTimeMillis();
    Long last = lastPollCheckAt.get(key);
    if (last != null && now - last < min) return;
    lastPollCheckAt.put(key, now);
    String name = label == null || label.trim().isEmpty() ? "Gate" : label.trim();
    KeepAlivePrefs.appendNativeEvent(
      context,
      kind == null || kind.trim().isEmpty() ? "skipped_refine" : kind,
      key.startsWith("_") ? "" : key,
      name + ": poll skipped — " + detail,
      "poll",
      now,
      meters
    );
    String skipReason =
      "skipped_bt".equals(kind)
        ? "bt_missing"
        : "skipped_refine".equals(kind) ? "outside_radius" : "other";
    GateAutoTelemetry.autoSkip(
      context,
      skipReason,
      analyticsSource,
      key.startsWith("_") ? "" : key,
      meters,
      gate
    );
  }

  private static boolean isExpectedOpenFailure(Exception e) {
    return e instanceof java.io.IOException
      || e instanceof IllegalStateException
      || e instanceof org.json.JSONException;
  }

  /**
   * Prefer a fresh fused fix. A locked phone's getLastLocation is often the
   * Play triggering loc from tens of meters out (or hours old) — recycling it
   * made the 25s near-miss re-check a no-op. Never startForegroundService.
   */
  private static Location resolvePollLocation(Context context) {
    Location last = lastLocation(context);
    if (isFresh(last)) {
      Log.i(TAG, "native poll loc=fused last age=" + locAgeMs(last) + "ms");
      return last;
    }
    Location fresh = currentLocation(context, true);
    if (fresh != null) {
      Log.i(TAG, "native poll loc=fresh age=" + locAgeMs(fresh) + "ms");
      return fresh;
    }
    if (last != null) {
      Log.i(TAG, "native poll loc=stale last age=" + locAgeMs(last) + "ms");
      return last;
    }
    boolean fgs = locationFgsRunning(context);
    if (!fgs) {
      Log.w(
        TAG,
        "native poll — no last location (location FGS not running; not starting FGS from background). Samsung: Settings → Apps → GateAuto → Battery → Unrestricted so the keep-alive FGS started at Auto-on can stay alive while locked."
      );
    } else {
      Log.w(TAG, "native poll — no last location (FGS running but getCurrentLocation empty)");
    }
    return null;
  }

  private static boolean isFresh(Location loc) {
    return loc != null && locAgeMs(loc) < FRESH_LOC_MAX_AGE_MS;
  }

  private static long locAgeMs(Location loc) {
    if (loc == null) return Long.MAX_VALUE;
    try {
      long ageNs = SystemClock.elapsedRealtimeNanos() - loc.getElapsedRealtimeNanos();
      if (ageNs < 0) return 0L;
      return ageNs / 1_000_000L;
    } catch (Exception e) {
      return Long.MAX_VALUE;
    }
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

  private static Location currentLocation(Context context, boolean highAccuracy) {
    try {
      FusedLocationProviderClient fused =
        LocationServices.getFusedLocationProviderClient(context);
      CancellationTokenSource cancel = new CancellationTokenSource();
      int priority =
        highAccuracy
          ? Priority.PRIORITY_HIGH_ACCURACY
          : Priority.PRIORITY_BALANCED_POWER_ACCURACY;
      return Tasks.await(
        fused.getCurrentLocation(priority, cancel.getToken()),
        CURRENT_LOC_TIMEOUT_S,
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
   *
   * <p>This read is always instant. It never binds a BluetoothProfile
   * proxy, never waits on a latch and never depends on the main looper, because
   * all three of those things sit between the driver and an open gate: the proxy
   * callback lands on the main thread, and on a cold locked-phone wake that
   * thread is busy starting the process, so a wait there stalls the open and
   * then times out looking exactly like "car not connected".
   * {@link CarBluetoothState} keeps the answer ready ahead of time instead.
   *
   * <p>Tri-state: only a confident "no" blocks. An unreadable state falls open on
   * proximity, which already gated the open, so a Bluetooth problem can never
   * again stop the gate from opening.
   */
  private static boolean bluetoothMatches(Context context, JSONObject gate) {
    if (!gate.optBoolean("btRequired", false)) return true;

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
    if (wantAddr.isEmpty() && wantName.isEmpty()) {
      Log.i(
        TAG,
        "native BT skip "
          + gate.optString("id")
          + " — required but no listed car address/name"
      );
      return false;
    }

    long started = SystemClock.elapsedRealtime();
    int state = CarBluetoothState.match(context, wantAddr, wantName);
    long tookMs = SystemClock.elapsedRealtime() - started;
    if (state == CarBluetoothState.CONNECTED) {
      Log.i(
        TAG,
        "native BT ok " + gate.optString("id") + " — listed car connected (" + tookMs + "ms)"
      );
      return true;
    }
    if (state == CarBluetoothState.UNKNOWN) {
      // Cannot verify BT (no BLUETOOTH_CONNECT, or the set has never been read
      // in full). Proximity already gated this open — allow it rather than
      // silently refuse. Mirrors the JS "unknown → fall open on proximity" path.
      Log.i(
        TAG,
        "native BT "
          + gate.optString("id")
          + " — car BT state unknown ("
          + CarBluetoothState.describe()
          + ", "
          + tookMs
          + "ms); allowing on proximity"
      );
      return true;
    }
    Log.i(
      TAG,
      "native BT skip "
        + gate.optString("id")
        + " — listed car not connected (wantAddr="
        + wantAddr.size()
        + " wantName="
        + wantName.size()
        + ", "
        + CarBluetoothState.describe()
        + ", "
        + tookMs
        + "ms)"
    );
    return false;
  }

  private static String normalizeAddr(String raw) {
    return CarBluetoothState.normalizeAddr(raw);
  }

  private static void notifyOpened(Context context, String label) {
    if (!KeepAlivePrefs.gateOpenNoticeVisible(context)) return;
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
