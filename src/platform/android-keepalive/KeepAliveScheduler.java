package com.gateauto.app.keepalive;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.os.SystemClock;
import android.util.Log;

/**
 * Doze-proof wake while Auto-open is armed. Expo's keep-alive uses JobScheduler
 * location updates, which Samsung batches for hours when the screen is locked.
 */
public final class KeepAliveScheduler {
  private static final String TAG = "GateAutoKeepAlive";
  static final String ACTION_ALARM = "com.gateauto.app.KEEPALIVE_ALARM";
  static final String ACTION_COOLDOWN = "com.gateauto.app.COOLDOWN_WAKE";
  private static final int REQ = 71001;
  private static final int REQ_COOLDOWN = 71002;
  /** First recovery quickly after arm / process start. */
  private static final long FIRST_DELAY_MS = 60 * 1000L;
  /** Then every 9 min — re-register Play fences (swipe/Doze drop) + poll. */
  static final long INTERVAL_MS = 9 * 60 * 1000L;
  /** Don't spawn overlapping headless runs from SCREEN_ON. */
  static final long MIN_RUN_GAP_MS = 60 * 1000L;

  private static BroadcastReceiver screenReceiver;
  private static boolean screenRegistered = false;

  private KeepAliveScheduler() {}

  public static void start(Context context) {
    Context app = context.getApplicationContext();
    registerScreenReceiver(app);
    scheduleNext(app, FIRST_DELAY_MS);
    Log.i(TAG, "keep-alive alarm armed");
  }

  public static void stop(Context context) {
    Context app = context.getApplicationContext();
    AlarmManager am = (AlarmManager) app.getSystemService(Context.ALARM_SERVICE);
    if (am != null) {
      am.cancel(pending(app));
      am.cancel(cooldownPending(app));
    }
    unregisterScreenReceiver(app);
    Log.i(TAG, "keep-alive alarm cancelled");
  }

  public static void scheduleNext(Context context, long delayMs) {
    Context app = context.getApplicationContext();
    AlarmManager am = (AlarmManager) app.getSystemService(Context.ALARM_SERVICE);
    if (am == null) return;
    long trigger = SystemClock.elapsedRealtime() + Math.max(5_000L, delayMs);
    PendingIntent pi = pending(app);
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        boolean exact =
          Build.VERSION.SDK_INT < Build.VERSION_CODES.S
            || am.canScheduleExactAlarms();
        if (exact) {
          am.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, trigger, pi);
        } else {
          am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, trigger, pi);
        }
      } else {
        am.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, trigger, pi);
      }
    } catch (Exception e) {
      Log.w(TAG, "scheduleNext failed", e);
      try {
        am.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, trigger, pi);
      } catch (Exception ignored) {
        // ignore
      }
    }
  }

  /**
   * Wake JS at cooldown expiry. Samsung batches Balanced location to ~2 min
   * while stationary — this is what honors a 20s gate cooldown.
   */
  public static void scheduleCooldownWake(Context context, long delayMs) {
    Context app = context.getApplicationContext();
    AlarmManager am = (AlarmManager) app.getSystemService(Context.ALARM_SERVICE);
    if (am == null) return;
    long delay = Math.min(15 * 60 * 1000L, Math.max(2_000L, delayMs));
    long trigger = SystemClock.elapsedRealtime() + delay;
    PendingIntent pi = cooldownPending(app);
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        boolean exact =
          Build.VERSION.SDK_INT < Build.VERSION_CODES.S
            || am.canScheduleExactAlarms();
        if (exact) {
          am.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, trigger, pi);
        } else {
          am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, trigger, pi);
        }
      } else {
        am.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, trigger, pi);
      }
      Log.i(TAG, "cooldown wake in " + delay + "ms");
    } catch (Exception e) {
      Log.w(TAG, "scheduleCooldownWake failed", e);
    }
  }

  static boolean shouldThrottle(Context context) {
    long last = KeepAlivePrefs.lastRunAt(context);
    return last > 0 && System.currentTimeMillis() - last < MIN_RUN_GAP_MS;
  }

  private static PendingIntent pending(Context context) {
    return broadcastPending(context, ACTION_ALARM, REQ);
  }

  private static PendingIntent cooldownPending(Context context) {
    return broadcastPending(context, ACTION_COOLDOWN, REQ_COOLDOWN);
  }

  private static PendingIntent broadcastPending(Context context, String action, int req) {
    Intent intent = new Intent(context, KeepAliveReceiver.class);
    intent.setAction(action);
    int flags = PendingIntent.FLAG_UPDATE_CURRENT;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      flags |= PendingIntent.FLAG_IMMUTABLE;
    }
    return PendingIntent.getBroadcast(context, req, intent, flags);
  }

  private static synchronized void registerScreenReceiver(Context app) {
    if (screenRegistered) return;
    screenReceiver =
      new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
          if (intent == null) return;
          String action = intent.getAction();
          if (!Intent.ACTION_SCREEN_ON.equals(action)
            && !Intent.ACTION_USER_PRESENT.equals(action)) {
            return;
          }
          if (!KeepAlivePrefs.isArmed(context)) return;
          KeepAliveReceiver.startSync(context, "screen");
        }
      };
    IntentFilter filter = new IntentFilter();
    filter.addAction(Intent.ACTION_SCREEN_ON);
    filter.addAction(Intent.ACTION_USER_PRESENT);
    try {
      if (Build.VERSION.SDK_INT >= 33) {
        app.registerReceiver(screenReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
      } else {
        app.registerReceiver(screenReceiver, filter);
      }
      screenRegistered = true;
    } catch (Exception e) {
      Log.w(TAG, "registerScreenReceiver failed", e);
    }
  }

  private static synchronized void unregisterScreenReceiver(Context app) {
    if (!screenRegistered || screenReceiver == null) return;
    try {
      app.unregisterReceiver(screenReceiver);
    } catch (Exception ignored) {
      // ignore
    }
    screenRegistered = false;
    screenReceiver = null;
  }
}
