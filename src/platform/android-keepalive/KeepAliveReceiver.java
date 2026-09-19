package com.gateauto.app.keepalive;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;

/**
 * Alarm / SCREEN_ON / cooldown: refresh Play fences (INITIAL_TRIGGER 0) and
 * poll/open in this process. Samsung often never delivers ENTER while locked —
 * pollNearby is the recover path (fresh GPS if last-loc is stale, inside user
 * radius + auto-on + cooldown + listed car if BT-required). Never start a
 * location FGS from here.
 */
public class KeepAliveReceiver extends BroadcastReceiver {
  private static final String TAG = "GateAutoKeepAlive";
  /** Keep the CPU up long enough for a High GPS sample while locked. */
  private static final long RECOVER_WAKELOCK_MS = 20_000L;

  @Override
  public void onReceive(Context context, Intent intent) {
    if (context == null) return;
    String action = intent != null ? intent.getAction() : null;
    boolean alarm = KeepAliveScheduler.ACTION_ALARM.equals(action);
    boolean cooldown = KeepAliveScheduler.ACTION_COOLDOWN.equals(action);
    boolean holdPulse = KeepAliveScheduler.ACTION_HOLD_PULSE.equals(action);
    if (alarm) {
      KeepAliveScheduler.scheduleNext(context, KeepAliveScheduler.INTERVAL_MS);
    }
    if (!KeepAlivePrefs.isArmed(context)) return;
    // Any armed wake: hold the (possibly cold-started) process with a
    // non-location FGS so LMK cannot evict it back to cached/empty between
    // arrivals. Never starts a location FGS from the background.
    HoldService.ensure(context);
    if (holdPulse) {
      String deviceId =
        intent != null
          ? intent.getStringExtra(KeepAliveScheduler.EXTRA_DEVICE_ID)
          : null;
      runHoldPulse(goAsync(), context, deviceId);
      return;
    }
    if (cooldown) {
      runNative(goAsync(), context, "cooldown", false);
      return;
    }
    if (KeepAliveScheduler.shouldThrottle(context)) {
      Log.i(TAG, "skip sync (" + (alarm ? "alarm" : action) + ") — throttled");
      GateAutoTelemetry.keepaliveTick(context, "skip");
      return;
    }
    KeepAlivePrefs.markRun(context);
    runNative(
      goAsync(),
      context,
      alarm ? "alarm" : (action != null ? action : "unknown"),
      true
    );
  }

  static void startSync(Context context, String reason) {
    if (!KeepAlivePrefs.isArmed(context)) return;
    HoldService.ensure(context);
    if (KeepAliveScheduler.shouldThrottle(context)) {
      Log.i(TAG, "skip sync (" + reason + ") — throttled");
      GateAutoTelemetry.keepaliveTick(context, "skip");
      return;
    }
    KeepAlivePrefs.markRun(context);
    Log.i(TAG, "native recover (" + reason + ")");
    final Context app = context.getApplicationContext();
    new Thread(
      () -> {
        PowerManager.WakeLock wakeLock = acquireRecoverWakeLock(app);
        try {
          GeofenceRegistrar.refresh(app);
          PalGateNativeOpen.pollNearby(app, "recover");
        } finally {
          releaseWakeLock(wakeLock);
        }
      },
      "gateauto-screen"
    ).start();
  }

  private static void runHoldPulse(
    PendingResult pending,
    Context context,
    String deviceId
  ) {
    Log.i(TAG, "native hold pulse " + deviceId);
    final Context app = context.getApplicationContext();
    new Thread(
      () -> {
        try {
          PalGateNativeOpen.pulseHold(app, deviceId);
        } finally {
          new Handler(Looper.getMainLooper()).post(pending::finish);
        }
      },
      "gateauto-hold"
    ).start();
  }

  private static void runNative(
    PendingResult pending,
    Context context,
    String reason,
    boolean reregister
  ) {
    Log.i(TAG, "native recover (" + reason + ")");
    final Context app = context.getApplicationContext();
    new Thread(
      () -> {
        PowerManager.WakeLock wakeLock = acquireRecoverWakeLock(app);
        try {
          if (reregister) {
            GeofenceRegistrar.refresh(app);
          }
          PalGateNativeOpen.pollNearby(app, "recover");
        } finally {
          releaseWakeLock(wakeLock);
          new Handler(Looper.getMainLooper()).post(pending::finish);
        }
      },
      "gateauto-" + reason
    ).start();
  }

  private static PowerManager.WakeLock acquireRecoverWakeLock(Context context) {
    try {
      PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
      if (pm == null) return null;
      PowerManager.WakeLock wl =
        pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "GateAuto:recoverGps");
      wl.setReferenceCounted(false);
      wl.acquire(RECOVER_WAKELOCK_MS);
      return wl;
    } catch (Exception e) {
      Log.w(TAG, "recover wakelock acquire failed", e);
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
