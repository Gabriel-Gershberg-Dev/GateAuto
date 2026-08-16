package com.gateauto.app.keepalive;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * Alarm / SCREEN_ON / cooldown: re-register native geofences and start
 * headless JS. Cooldown wakes are not throttled — they must honor ~20s.
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
      Log.i(TAG, "cooldown wake — native poll");
      final PendingResult pending = goAsync();
      final Context app = context.getApplicationContext();
      new Thread(
        () -> {
          try {
            PalGateNativeOpen.pollNearby(app);
          } finally {
            new android.os.Handler(android.os.Looper.getMainLooper()).post(pending::finish);
          }
        },
        "gateauto-cooldown"
      ).start();
      return;
    }
    startSync(context, alarm ? "alarm" : (action != null ? action : "unknown"));
  }

  static void startSync(Context context, String reason) {
    if (!KeepAlivePrefs.isArmed(context)) return;
    if (KeepAliveScheduler.shouldThrottle(context)) {
      Log.i(TAG, "skip sync (" + reason + ") — throttled");
      return;
    }
    KeepAlivePrefs.markRun(context);
    Log.i(TAG, "native recover (" + reason + ")");
    GeofenceRegistrar.register(context, false);
    KeepAliveService.startJs(context, "poll", null, null, null);
  }
}
