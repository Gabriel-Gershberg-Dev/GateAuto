package com.gateauto.app.keepalive;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import androidx.annotation.Nullable;

/**
 * Lightweight process-hold foreground service (NON-location).
 *
 * <p>Why this exists: {@link MonitoringService} is a LOCATION-type FGS and, on
 * Samsung, a location FGS started from the background has its GPS stripped —
 * so the code never (re)starts it from a broadcast wake. That left a window
 * where a broadcast (geofence / recover alarm) cold-started the process but no
 * foreground service held it, so oom_adj dropped to cached/empty and LMK
 * evicted it within minutes. Every later arrival then paid a full cold start
 * (RN/JS init + fence re-register + FGS re-promote) → the ~10–15s phase-1 delay.
 *
 * <p>HoldService requests NO location. It only pins the process at
 * foreground/perceptible priority with a quiet ongoing notification so LMK
 * will not evict it between arrivals. It is {@code specialUse} (not
 * {@code location}), so starting it from a background broadcast does not
 * trigger Samsung's background-location-FGS GPS stripping. Opens still use the
 * fence's triggering location / fused last-known via the existing native path.
 *
 * <p>Started from any process wake while armed (MainApplication.onCreate, the
 * recover alarm, geofence, BT, screen). Stopped when {@link MonitoringService}
 * takes over the hold (foreground), and on disarm. Both services post the same
 * {@link MonitoringNotice} on the same channel, so the hand-off is seamless and
 * the user only ever sees one monitoring notification.
 */
public class HoldService extends Service {
  private static final String TAG = "GateAutoKeepAlive";
  static final int NOTIF_ID = 41005;
  /** Re-render the notice age only; checks here come from the recover alarm. */
  private static final long NOTICE_REFRESH_MS = 30_000L;

  private static volatile boolean running = false;
  private static volatile HoldService instance;

  private final Handler handler = new Handler(Looper.getMainLooper());
  private final Runnable refreshNotice =
    new Runnable() {
      @Override
      public void run() {
        MonitoringNotice.update(HoldService.this);
        handler.postDelayed(this, NOTICE_REFRESH_MS);
      }
    };

  public static boolean isRunning() {
    return running;
  }

  /**
   * Re-apply the searching-notice preference on the running hold service.
   * @return true if this service owned the notice
   */
  static boolean resyncNotice() {
    HoldService svc = instance;
    if (svc == null) return false;
    svc.handler.post(
      () -> {
        if (KeepAlivePrefs.monitorNoticeVisible(svc)) {
          svc.promote();
        } else {
          MonitoringNotice.hideShadeIfDisabled(svc, NOTIF_ID);
        }
      }
    );
    return true;
  }

  /**
   * Promote a non-location FGS to hold the process, if armed. No-op when the
   * location {@link MonitoringService} is already holding it (foreground), or
   * when not armed. Safe to call from a background broadcast — the device power
   * allowlist exempts it from the Android 12+ background-FGS-start restriction,
   * and specialUse (unlike location) has no GPS to strip.
   */
  public static void ensure(Context context) {
    if (context == null) return;
    Context app = context.getApplicationContext();
    if (!KeepAlivePrefs.isArmed(app)) return;
    // Location FGS already holds the process — no need for a second FGS.
    if (MonitoringService.isRunning()) return;
    if (running) return;
    Intent intent = new Intent(app, HoldService.class);
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        app.startForegroundService(intent);
      } else {
        app.startService(intent);
      }
      Log.i(TAG, "HoldService.ensure requested (non-location process hold)");
    } catch (Exception e) {
      // ForegroundServiceStartNotAllowedException etc. — never crash a wake.
      Log.w(TAG, "HoldService.ensure failed (background FGS start blocked?)", e);
    }
  }

  public static void stop(Context context) {
    if (context == null) return;
    try {
      context.getApplicationContext().stopService(
        new Intent(context.getApplicationContext(), HoldService.class)
      );
    } catch (Exception e) {
      Log.w(TAG, "HoldService.stop failed", e);
    }
  }

  @Override
  public void onCreate() {
    super.onCreate();
    instance = this;
    running = true;
    ensureChannel();
    promote();
    // This is the service that comes up on a cold background wake, so it is the
    // right place to get the car-BT proxies bound before an open needs them.
    CarBluetoothState.prime(this);
    handler.postDelayed(refreshNotice, NOTICE_REFRESH_MS);
    Log.i(TAG, "HoldService started (process hold, no location)");
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    if (!KeepAlivePrefs.isArmed(this)) {
      stopSelf();
      return START_NOT_STICKY;
    }
    // A location FGS came up meanwhile — let it own the hold and step aside.
    if (MonitoringService.isRunning()) {
      stopSelf();
      return START_NOT_STICKY;
    }
    promote();
    return START_STICKY;
  }

  private void promote() {
    try {
      int type =
        Build.VERSION.SDK_INT >= 34
          ? ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
          : 0;
      MonitoringNotice.startForegroundHonoringPreference(this, NOTIF_ID, type);
    } catch (Exception e) {
      Log.w(TAG, "HoldService.promote startForeground failed", e);
      stopSelf();
    }
  }

  @Override
  public void onDestroy() {
    if (instance == this) instance = null;
    running = false;
    handler.removeCallbacks(refreshNotice);
    MonitoringNotice.clearOrphan(this, NOTIF_ID);
    Log.i(TAG, "HoldService destroyed");
    super.onDestroy();
  }

  @Nullable
  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }

  /** Same live status notice as {@link MonitoringService} — one coherent UX. */
  private Notification buildNotification() {
    return MonitoringNotice.build(this, NOTIF_ID);
  }

  /** Same channel as {@link MonitoringService} so the hold notice is seamless. */
  private void ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    NotificationManager manager = getSystemService(NotificationManager.class);
    if (manager == null) return;
    NotificationChannel channel =
      new NotificationChannel(
        MonitoringService.CHANNEL_ID,
        "GateAuto searching",
        NotificationManager.IMPORTANCE_LOW
      );
    channel.setDescription("Pinned while Auto-open is searching for nearby gates");
    channel.setShowBadge(false);
    channel.setSound(null, null);
    channel.enableVibration(false);
    manager.createNotificationChannel(channel);
  }
}
