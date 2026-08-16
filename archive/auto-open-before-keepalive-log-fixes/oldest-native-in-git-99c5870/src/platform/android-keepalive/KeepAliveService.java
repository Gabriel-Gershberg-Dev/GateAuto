package com.gateauto.app.keepalive;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Bundle;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

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

  public static void startJs(
    Context context,
    String reason,
    @Nullable String identifier,
    @Nullable String name,
    @Nullable String address
  ) {
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
      android.util.Log.w("GateAutoKeepAlive", "KeepAliveService.startJs failed", e);
    }
  }

  @Override
  public void onCreate() {
    super.onCreate();
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
}
