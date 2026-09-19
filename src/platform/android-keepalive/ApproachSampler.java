package com.gateauto.app.keepalive;

import android.content.Context;
import android.location.Location;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Log;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

/**
 * 1 Hz High GPS while approaching a pin, without starting a location FGS
 * (Samsung strips GPS if that FGS is started from the background).
 *
 * <p>Play wakes us at ~100m. This sampler watches the user's configured radius
 * so the open fires on the first fix that is actually inside 25m / 40m / …
 * instead of waiting for the next 5–30s tick. Stopped when the location
 * {@link MonitoringService} is already sampling, when we leave every detect
 * fence, on disarm, or after {@link #SESSION_MAX_MS}.
 */
public final class ApproachSampler {
  private static final String TAG = "GateAutoKeepAlive";
  static final long INTERVAL_MS = 1_000L;
  static final long MIN_INTERVAL_MS = 500L;
  static final long SESSION_MAX_MS = 90_000L;

  private static final Object LOCK = new Object();
  private static HandlerThread thread;
  private static Handler handler;
  private static FusedLocationProviderClient fused;
  private static LocationCallback callback;
  private static PowerManager.WakeLock wakeLock;
  private static long deadlineElapsed;
  private static Context app;
  private static int farStreak;

  private ApproachSampler() {}

  public static void start(Context context) {
    if (context == null) return;
    if (!KeepAlivePrefs.isArmed(context)) return;
    // Location FGS already at 1 Hz when near — don't double-sample.
    if (MonitoringService.isRunning()) return;
    synchronized (LOCK) {
      if (callback != null) {
        return;
      }
      deadlineElapsed = SystemClock.elapsedRealtime() + SESSION_MAX_MS;
      farStreak = 0;
      app = context.getApplicationContext();
      thread = new HandlerThread("gateauto-approach");
      thread.start();
      handler = new Handler(thread.getLooper());
      fused = LocationServices.getFusedLocationProviderClient(app);
      callback =
        new LocationCallback() {
          @Override
          public void onLocationResult(LocationResult result) {
            onFix(result != null ? result.getLastLocation() : null);
          }
        };
      LocationRequest request =
        new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, INTERVAL_MS)
          .setMinUpdateIntervalMillis(MIN_INTERVAL_MS)
          .setMinUpdateDistanceMeters(0)
          .setWaitForAccurateLocation(false)
          .build();
      try {
        fused.requestLocationUpdates(request, callback, thread.getLooper());
      } catch (SecurityException e) {
        Log.w(TAG, "approach sampler location denied", e);
        stopLocked();
        return;
      } catch (Exception e) {
        Log.w(TAG, "approach sampler start failed", e);
        stopLocked();
        return;
      }
      acquireWakeLock();
      Log.i(TAG, "approach sampler 1Hz high GPS for up to " + SESSION_MAX_MS + "ms");
    }
  }

  public static void stop() {
    synchronized (LOCK) {
      stopLocked();
    }
  }

  private static void onFix(Location loc) {
    long now = SystemClock.elapsedRealtime();
    Context ctx;
    synchronized (LOCK) {
      if (callback == null) return;
      if (now > deadlineElapsed) {
        Log.i(TAG, "approach sampler deadline");
        stopLocked();
        return;
      }
      ctx = app;
    }
    if (ctx == null || !KeepAlivePrefs.isArmed(ctx)) {
      stop();
      return;
    }
    if (MonitoringService.isRunning()) {
      stop();
      return;
    }
    if (loc != null) {
      PalGateNativeOpen.pollNearby(ctx, "poll", loc);
    }
    if (loc != null && PalGateNativeOpen.anyWithinDetect(ctx, loc)) {
      farStreak = 0;
    } else {
      farStreak++;
      // One coarse bounce outside the detect fence shouldn't kill the session.
      if (farStreak >= 3) {
        Log.i(TAG, "approach sampler left detect fence");
        stop();
      }
    }
  }

  private static void acquireWakeLock() {
    try {
      PowerManager pm = (PowerManager) app.getSystemService(Context.POWER_SERVICE);
      if (pm == null) return;
      wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "GateAuto:approachGps");
      wakeLock.setReferenceCounted(false);
      wakeLock.acquire(SESSION_MAX_MS);
    } catch (Exception e) {
      Log.w(TAG, "approach sampler wakelock failed", e);
      wakeLock = null;
    }
  }

  private static void stopLocked() {
    if (fused != null && callback != null) {
      try {
        fused.removeLocationUpdates(callback);
      } catch (Exception ignored) {
        // ignore
      }
    }
    callback = null;
    fused = null;
    if (wakeLock != null) {
      try {
        if (wakeLock.isHeld()) wakeLock.release();
      } catch (Exception ignored) {
        // ignore
      }
      wakeLock = null;
    }
    if (handler != null) {
      handler.removeCallbacksAndMessages(null);
      handler = null;
    }
    if (thread != null) {
      thread.quitSafely();
      thread = null;
    }
    app = null;
    farStreak = 0;
  }
}
