package com.gateauto.app.keepalive;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationListener;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import com.google.android.gms.tasks.CancellationTokenSource;
import com.google.android.gms.tasks.Tasks;

import java.util.concurrent.TimeUnit;

import com.gateauto.app.R;

/**
 * PalGate-style search FGS while Auto-open is armed: one ongoing, non-clearable
 * “Searching for nearby gates” notice plus balanced location so the process
 * stays eligible for geofence / BT / JS poll.
 */
public class MonitoringService extends Service {
  private static final String TAG = "GateAutoKeepAlive";
  /** New id so Samsung does not keep the old IMPORTANCE_MIN channel. */
  static final String CHANNEL_ID = "gateauto-searching-v2";
  static final int NOTIF_ID = 41003;
  private static final long REREGISTER_MS = 8 * 60 * 1000L;
  private static final long LOCATION_INTERVAL_MS = 30_000L;

  private static volatile MonitoringService instance;
  private final Handler handler = new Handler(Looper.getMainLooper());
  private FusedLocationProviderClient fused;

  public static boolean isRunning() {
    return instance != null;
  }

  /** One-shot in this already-running FGS. Does not start a new service. */
  public static Location awaitFreshLocation(long timeoutMs) {
    MonitoringService svc = instance;
    if (svc == null) return null;
    FusedLocationProviderClient client = svc.fused;
    if (client == null) {
      client = LocationServices.getFusedLocationProviderClient(svc);
    }
    try {
      CancellationTokenSource cancel = new CancellationTokenSource();
      return Tasks.await(
        client.getCurrentLocation(
          Priority.PRIORITY_BALANCED_POWER_ACCURACY,
          cancel.getToken()
        ),
        Math.max(1_000L, timeoutMs),
        TimeUnit.MILLISECONDS
      );
    } catch (Exception e) {
      Log.w(TAG, "awaitFreshLocation failed", e);
      return null;
    }
  }

  private final LocationListener locationListener =
    location -> KeepAliveModule.requestJsPoll(MonitoringService.this);
  private final Runnable reregister =
    new Runnable() {
      @Override
      public void run() {
        if (!KeepAlivePrefs.isArmed(MonitoringService.this)) {
          stopSelf();
          return;
        }
        GeofenceRegistrar.refresh(MonitoringService.this);
        PalGateNativeOpen.pollNearby(MonitoringService.this);
        handler.postDelayed(this, REREGISTER_MS);
      }
    };

  /**
   * Start from the UI / Android Auto process only. Alarm/SCREEN_ON must never
   * call this — Android 12+ rejects background location FGS starts.
   */
  public static void start(Context context) {
    if (!KeepAlivePrefs.isArmed(context)) return;
    Intent intent = new Intent(context, MonitoringService.class);
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent);
      } else {
        context.startService(intent);
      }
      Log.i(TAG, "MonitoringService.start requested (UI/AA process)");
    } catch (Exception e) {
      Log.w(
        TAG,
        "MonitoringService.start failed (background FGS start blocked?)",
        e
      );
    }
  }

  public static void stop(Context context) {
    try {
      context.stopService(new Intent(context, MonitoringService.class));
    } catch (Exception e) {
      Log.w(TAG, "MonitoringService.stop failed", e);
    }
  }

  @Override
  public void onCreate() {
    super.onCreate();
    instance = this;
    ensureChannel();
    Notification notification = buildPinnedNotification();
    if (Build.VERSION.SDK_INT >= 34) {
      startForeground(
        NOTIF_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
      );
    } else {
      startForeground(NOTIF_ID, notification);
    }
    GeofenceRegistrar.register(this, false);
    startLocationUpdates();
    KeepAliveModule.requestJsPoll(this);
    handler.postDelayed(reregister, REREGISTER_MS);
    Log.i(TAG, "MonitoringService started (searching, pinned)");
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    if (!KeepAlivePrefs.isArmed(this)) {
      stopSelf();
      return START_NOT_STICKY;
    }
    Notification pinned = buildPinnedNotification();
    if (Build.VERSION.SDK_INT >= 34) {
      startForeground(NOTIF_ID, pinned, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
    } else {
      startForeground(NOTIF_ID, pinned);
    }
    return START_STICKY;
  }

  @Override
  public void onDestroy() {
    handler.removeCallbacks(reregister);
    stopLocationUpdates();
    if (instance == this) instance = null;
    Log.i(TAG, "MonitoringService destroyed");
    super.onDestroy();
  }

  @Nullable
  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }

  private Notification buildPinnedNotification() {
    Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
    PendingIntent content = null;
    if (launch != null) {
      launch.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
      int flags = PendingIntent.FLAG_UPDATE_CURRENT;
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        flags |= PendingIntent.FLAG_IMMUTABLE;
      }
      content = PendingIntent.getActivity(this, 0, launch, flags);
    }
    NotificationCompat.Builder builder =
      new NotificationCompat.Builder(this, CHANNEL_ID)
        .setContentTitle("GateAuto")
        .setContentText("Searching for nearby gates")
        .setSmallIcon(R.mipmap.ic_launcher)
        .setPriority(NotificationCompat.PRIORITY_LOW)
        .setCategory(NotificationCompat.CATEGORY_SERVICE)
        .setOngoing(true)
        .setAutoCancel(false)
        .setOnlyAlertOnce(true)
        .setSilent(true)
        .setForegroundServiceBehavior(
          NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE
        );
    if (content != null) {
      builder.setContentIntent(content);
    }
    Notification notification = builder.build();
    notification.flags |= Notification.FLAG_NO_CLEAR | Notification.FLAG_ONGOING_EVENT;
    return notification;
  }

  private void startLocationUpdates() {
    fused = LocationServices.getFusedLocationProviderClient(this);
    LocationRequest request =
      new LocationRequest.Builder(Priority.PRIORITY_BALANCED_POWER_ACCURACY, LOCATION_INTERVAL_MS)
        .setMinUpdateIntervalMillis(15_000L)
        .setMinUpdateDistanceMeters(0)
        .setWaitForAccurateLocation(false)
        .build();
    try {
      fused.requestLocationUpdates(request, locationListener, Looper.getMainLooper());
    } catch (SecurityException e) {
      Log.w(TAG, "location updates denied", e);
    }
  }

  private void stopLocationUpdates() {
    if (fused == null) return;
    try {
      fused.removeLocationUpdates(locationListener);
    } catch (Exception ignored) {
      // ignore
    }
    fused = null;
  }

  private void ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    NotificationManager manager = getSystemService(NotificationManager.class);
    if (manager == null) return;
    NotificationChannel channel =
      new NotificationChannel(
        CHANNEL_ID,
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
