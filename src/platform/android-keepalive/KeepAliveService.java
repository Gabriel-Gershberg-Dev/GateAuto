package com.gateauto.app.keepalive;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import java.util.concurrent.atomic.AtomicBoolean;

import com.facebook.react.HeadlessJsTaskService;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.jstasks.HeadlessJsTaskConfig;
import com.gateauto.app.R;

/**
 * Brief FGS + headless JS for a real open (geofence / BT / recovery poll).
 */
public class KeepAliveService extends HeadlessJsTaskService {
  private static final String CHANNEL_ID = "gateauto-keepalive";
  private static final int NOTIF_ID = 41002;
  public static final String TASK_NAME = "GateAutoKeepAliveSync";
  /** Headless High-GPS can hang far past RN's 90s timeout on Samsung. */
  private static final long HUNG_WATCHDOG_MS = 25_000L;
  private static final AtomicBoolean running = new AtomicBoolean(false);

  public static boolean isRunning() {
    return running.get();
  }

  public static void startJs(
    Context context,
    String reason,
    @Nullable String identifier,
    @Nullable String name,
    @Nullable String address
  ) {
    if (!running.compareAndSet(false, true)) {
      android.util.Log.i("GateAutoKeepAlive", "KeepAliveService.startJs skip — already running");
      GateAutoTelemetry.keepaliveTick(context, "skip");
      return;
    }
    Intent service = new Intent(context, KeepAliveService.class);
    service.putExtra("reason", reason == null ? "poll" : reason);
    if (identifier != null) service.putExtra("identifier", identifier);
    if (name != null) service.putExtra("name", name);
    if (address != null) service.putExtra("address", address);
    HeadlessJsTaskService.acquireWakeLockNow(context);
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(service);
      } else {
        context.startService(service);
      }
    } catch (Exception e) {
      running.set(false);
      android.util.Log.w("GateAutoKeepAlive", "KeepAliveService.startJs failed", e);
    }
  }

  @Override
  public void onCreate() {
    super.onCreate();
    running.set(true);
    new Handler(Looper.getMainLooper())
      .postDelayed(
        () -> {
          if (running.get()) {
            android.util.Log.w(
              "GateAutoKeepAlive",
              "KeepAliveService watchdog — stopping hung headless JS"
            );
            GateAutoTelemetry.keepaliveTick(KeepAliveService.this, "hung_killed");
            GateAutoTelemetry.autoSkip(
              KeepAliveService.this,
              "hung",
              "poll",
              "",
              null,
              null
            );
            stopSelf();
          }
        },
        HUNG_WATCHDOG_MS
      );
    ensureChannel();
    Notification notification =
      new NotificationCompat.Builder(this, CHANNEL_ID)
        .setContentTitle("GateAuto auto-open")
        .setContentText("Checking gate…")
        .setSmallIcon(R.mipmap.ic_launcher)
        .setPriority(NotificationCompat.PRIORITY_MIN)
        .setCategory(NotificationCompat.CATEGORY_SERVICE)
        .setSilent(true)
        .setOngoing(false)
        .build();
    if (Build.VERSION.SDK_INT >= 34) {
      startForeground(
        NOTIF_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
      );
    } else {
      startForeground(NOTIF_ID, notification);
    }
  }

  private void ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    NotificationManager manager = getSystemService(NotificationManager.class);
    if (manager == null) return;
    NotificationChannel channel =
      new NotificationChannel(
        CHANNEL_ID,
        "GateAuto keep-alive",
        NotificationManager.IMPORTANCE_MIN
      );
    channel.setDescription("Brief notice while opening a gate in the background");
    channel.setShowBadge(false);
    manager.createNotificationChannel(channel);
  }

  @Override
  protected @Nullable HeadlessJsTaskConfig getTaskConfig(Intent intent) {
    Bundle extras = intent != null ? intent.getExtras() : null;
    return new HeadlessJsTaskConfig(
      TASK_NAME,
      extras != null ? Arguments.fromBundle(extras) : Arguments.createMap(),
      90_000,
      true
    );
  }

  @Override
  public void onDestroy() {
    running.set(false);
    super.onDestroy();
  }
}
