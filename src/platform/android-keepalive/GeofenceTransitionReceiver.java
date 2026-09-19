package com.gateauto.app.keepalive;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Log;

import com.google.android.gms.location.Geofence;
import com.google.android.gms.location.GeofencingEvent;

/**
 * Play Services geofence callback. Opens PalGate in this process (no JS / no
 * FGS start) so Android 14 background restrictions cannot block it.
 *
 * Cold-wake (hours idle → Samsung/Doze killed the process): the Play fence is
 * the only waker. goAsync() alone does not guarantee the CPU stays awake once
 * onReceive returns and the open runs on a worker thread — a cold LTE re-attach
 * + DNS + TLS can otherwise stall until the next Doze maintenance window. Hold
 * an explicit PARTIAL_WAKE_LOCK across the whole open so the network call runs
 * immediately. Capture broadcast-receipt time + whether a location FGS was warm
 * so auto_open telemetry can measure cold vs warm latency.
 */
public class GeofenceTransitionReceiver extends BroadcastReceiver {
  private static final String TAG = "GateAutoKeepAlive";
  /** Safety cap so the wakelock can never leak past a stuck open. */
  private static final long OPEN_WAKELOCK_MS = 45_000L;

  @Override
  public void onReceive(Context context, Intent intent) {
    if (context == null || !KeepAlivePrefs.isArmed(context)) return;

    // Hold the (possibly cold-started) process with a non-location FGS so it
    // stays warm for subsequent arrivals instead of dropping to cached/empty.
    HoldService.ensure(context);

    GeofencingEvent event = GeofencingEvent.fromIntent(intent);
    if (event == null) {
      Log.w(TAG, "null geofencing event");
      return;
    }
    if (event.hasError()) {
      Log.w(TAG, "geofencing error " + event.getErrorCode());
      return;
    }

    String reason =
      event.getGeofenceTransition() == Geofence.GEOFENCE_TRANSITION_EXIT ? "exit" : "enter";
    if (event.getTriggeringGeofences() == null) return;

    final PendingResult pending = goAsync();
    final Context app = context.getApplicationContext();
    final long startElapsed = SystemClock.elapsedRealtime();
    // Warm = a location FGS was already running when the fence fired (process
    // alive / recently used). Cold = it was not (killed after hours idle).
    final boolean warm = PalGateNativeOpen.locationFgsRunning(app);
    final PowerManager.WakeLock wakeLock = acquireOpenWakeLock(app);
    new Thread(
      () -> {
        try {
          for (Geofence geofence : event.getTriggeringGeofences()) {
            String id = geofence.getRequestId();
            if (id == null || id.trim().isEmpty()) continue;
            Log.i(TAG, "native geofence " + reason + " " + id + (warm ? " (warm)" : " (cold)"));
            PalGateNativeOpen.openFromGeofence(
              app,
              id,
              reason,
              event.getTriggeringLocation(),
              startElapsed,
              warm
            );
          }
          // One fence firing (e.g. the 40m pin) must still evaluate every nearby
          // gate against a fresh GPS fix — 25m Play fences often never ENTER.
          PalGateNativeOpen.onFenceWake(app, event.getTriggeringLocation());
        } finally {
          releaseWakeLock(wakeLock);
          new Handler(Looper.getMainLooper()).post(pending::finish);
        }
      },
      "gateauto-geo-open"
    ).start();
  }

  private static PowerManager.WakeLock acquireOpenWakeLock(Context context) {
    try {
      PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
      if (pm == null) return null;
      PowerManager.WakeLock wl =
        pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "GateAuto:geofenceOpen");
      wl.setReferenceCounted(false);
      wl.acquire(OPEN_WAKELOCK_MS);
      return wl;
    } catch (Exception e) {
      Log.w(TAG, "geofence open wakelock acquire failed", e);
      return null;
    }
  }

  private static void releaseWakeLock(PowerManager.WakeLock wakeLock) {
    if (wakeLock == null) return;
    try {
      if (wakeLock.isHeld()) wakeLock.release();
    } catch (Exception ignored) {
      // ignore
    }
  }
}
