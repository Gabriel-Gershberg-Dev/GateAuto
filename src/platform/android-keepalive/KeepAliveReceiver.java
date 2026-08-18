package com.gateauto.app.keepalive;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

/**
 * Alarm / SCREEN_ON / cooldown: refresh Play fences (INITIAL_TRIGGER 0) and
 * poll/open in this process. Samsung often never delivers ENTER while locked —
 * pollNearby is the recover path (inside radius + auto-on + cooldown + listed
 * car if BT-required). Never start a location FGS from here.
 */
public class KeepAliveReceiver extends BroadcastReceiver {
  private static final String TAG = "GateAutoKeepAlive";

  @Override
  public void onReceive(Context context, Intent intent) {
    if (context == null) return;
    String action = intent != null ? intent.getAction() : null;
    boolean alarm = KeepAliveScheduler.ACTION_ALARM.equals(action);
    boolean cooldown = KeepAliveScheduler.ACTION_COOLDOWN.equals(action);
    if (alarm) {
      KeepAliveScheduler.scheduleNext(context, KeepAliveScheduler.INTERVAL_MS);
    }
    if (!KeepAlivePrefs.isArmed(context)) return;
    if (cooldown) {
      runNative(goAsync(), context, "cooldown", false);
      return;
    }
    if (KeepAliveScheduler.shouldThrottle(context)) {
      Log.i(TAG, "skip sync (" + (alarm ? "alarm" : action) + ") — throttled");
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
    if (KeepAliveScheduler.shouldThrottle(context)) {
      Log.i(TAG, "skip sync (" + reason + ") — throttled");
      return;
    }
    KeepAlivePrefs.markRun(context);
    Log.i(TAG, "native recover (" + reason + ")");
    final Context app = context.getApplicationContext();
    new Thread(
      () -> {
        GeofenceRegistrar.refresh(app);
        PalGateNativeOpen.pollNearby(app);
      },
      "gateauto-screen"
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
        try {
          if (reregister) {
            GeofenceRegistrar.refresh(app);
          }
          PalGateNativeOpen.pollNearby(app);
        } finally {
          new Handler(Looper.getMainLooper()).post(pending::finish);
        }
      },
      "gateauto-" + reason
    ).start();
  }
}
