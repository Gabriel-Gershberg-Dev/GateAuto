package com.gateauto.app.keepalive;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
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

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationListener;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import com.google.android.gms.tasks.CancellationTokenSource;
import com.google.android.gms.tasks.Tasks;

import java.util.concurrent.TimeUnit;

/**
 * PalGate-style search FGS while Auto-open is armed: one ongoing, non-clearable
 * live status notice (see {@link MonitoringNotice}) plus balanced location so
 * the process stays eligible for geofence / BT / JS poll.
 */
public class MonitoringService extends Service {
  private static final String TAG = "GateAutoKeepAlive";
  /** New id so Samsung does not keep the old IMPORTANCE_MIN channel. */
  static final String CHANNEL_ID = "gateauto-searching-v2";
  static final int NOTIF_ID = 41003;
  private static final long REREGISTER_MS = 8 * 60 * 1000L;
  private static final long LOCATION_INTERVAL_MS = 30_000L;
  private static final long LOCATION_NEAR_INTERVAL_MS = 1_000L;
  private static final long LOCATION_NEAR_MIN_MS = 500L;
  /**
   * Re-render the "last check Xs ago" text so it cannot read stale between the
   * ~30s location ticks. Handler only (uptime-based): no alarm, no wakelock, and
   * it pauses in Doze — which is exactly when nobody is reading the shade.
   */
  private static final long NOTICE_REFRESH_MS = 15_000L;
  private static final long WIDGET_REFRESH_MIN_MS = 45_000L;
  private static volatile long lastWidgetRefreshAt;

  private static volatile MonitoringService instance;
  private final Handler handler = new Handler(Looper.getMainLooper());
  private FusedLocationProviderClient fused;
  private volatile boolean nearMode;

  public static boolean isRunning() {
    return instance != null;
  }

  /**
   * Re-apply the searching-notice preference on the running location service.
   * @return true if this service owned the notice
   */
  static boolean resyncNotice() {
    MonitoringService svc = instance;
    if (svc == null) return false;
    svc.handler.post(
      () -> {
        if (KeepAlivePrefs.monitorNoticeVisible(svc)) {
          svc.promoteOrHideNotice();
        } else {
          MonitoringNotice.hideShadeIfDisabled(svc, NOTIF_ID);
        }
      }
    );
    return true;
  }

  private void promoteOrHideNotice() {
    if (!KeepAlivePrefs.isArmed(this)) return;
    try {
      int type =
        Build.VERSION.SDK_INT >= 34
          ? ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
          : 0;
      MonitoringNotice.startForegroundHonoringPreference(this, NOTIF_ID, type);
    } catch (Exception e) {
      Log.w(TAG, "resync searching notice failed", e);
    }
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
    location -> {
      KeepAlivePrefs.markMonitorCheck(MonitoringService.this);
      MonitoringNotice.update(MonitoringService.this);
      final Location loc = location;
      final Context app = getApplicationContext();
      // Check this fix against the user's radius immediately — do not wait for
      // the 20s JS poll gap. Worker thread: pollNearby may HTTP-open.
      new Thread(() -> PalGateNativeOpen.pollNearby(app, "poll", loc), "gateauto-loc-poll")
        .start();
      maybeRefreshWidget(app, loc);
      boolean near = PalGateNativeOpen.anyWithinDetect(MonitoringService.this, location);
      if (near != nearMode) {
        handler.post(() -> startLocationUpdates(near));
      }
    };
  private final Runnable refreshNotice =
    new Runnable() {
      @Override
      public void run() {
        MonitoringNotice.update(MonitoringService.this);
        handler.postDelayed(this, NOTICE_REFRESH_MS);
      }
    };
  /**
   * The recover sweep Samsung makes necessary — it often never delivers ENTER
   * while locked. It must run on a worker thread: {@code Tasks.await} (fused
   * last-location, inside pollNearby) throws outright when called on the main
   * application thread, so running this on the Handler's looper silently turned
   * every recover into "no last location" and no gate could open from it.
   */
  private final Runnable reregister =
    new Runnable() {
      @Override
      public void run() {
        if (!KeepAlivePrefs.isArmed(MonitoringService.this)) {
          stopSelf();
          return;
        }
        final Context app = getApplicationContext();
        new Thread(
          () -> {
            GeofenceRegistrar.refresh(app);
            PalGateNativeOpen.pollNearby(app, "recover");
          },
          "gateauto-fgs-recover"
        ).start();
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
    // Location FGS now holds the process — retire the non-location HoldService
    // so only one "Searching for nearby gates" notice is shown.
    HoldService.stop(this);
    ensureChannel();
    promoteOrHideNotice();
    GeofenceRegistrar.register(this, false);
    ApproachSampler.stop();
    startLocationUpdates(false);
    CarBluetoothState.prime(this);
    KeepAliveModule.requestJsPoll(this);
    handler.postDelayed(reregister, REREGISTER_MS);
    handler.postDelayed(refreshNotice, NOTICE_REFRESH_MS);
    GateAutoTelemetry.refreshKeys(this);
    GateAutoTelemetry.permissionState(this);
    Log.i(TAG, "MonitoringService started (searching, pinned)");
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    if (!KeepAlivePrefs.isArmed(this)) {
      stopSelf();
      return START_NOT_STICKY;
    }
    HoldService.stop(this);
    promoteOrHideNotice();
    return START_STICKY;
  }

  @Override
  public void onDestroy() {
    handler.removeCallbacks(reregister);
    handler.removeCallbacks(refreshNotice);
    stopLocationUpdates();
    if (instance == this) instance = null;
    MonitoringNotice.clearOrphan(this, NOTIF_ID);
    // If still armed (e.g. app backgrounded / swiped away but not disarmed),
    // fall back to the non-location HoldService so the process stays held and
    // does not drop to cached/empty. On disarm, armed is already false → no-op.
    HoldService.ensure(this);
    Log.i(TAG, "MonitoringService destroyed");
    super.onDestroy();
  }

  @Nullable
  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }

  /** Live "Monitoring N gates · last check …" notice, sticky if swiped away. */
  private Notification buildPinnedNotification() {
    return MonitoringNotice.build(this, NOTIF_ID);
  }

  private void startLocationUpdates(boolean near) {
    if (fused == null) {
      fused = LocationServices.getFusedLocationProviderClient(this);
    } else {
      try {
        fused.removeLocationUpdates(locationListener);
      } catch (Exception ignored) {
        // ignore
      }
    }
    nearMode = near;
    long interval = near ? LOCATION_NEAR_INTERVAL_MS : LOCATION_INTERVAL_MS;
    long minInterval = near ? LOCATION_NEAR_MIN_MS : 15_000L;
    int priority =
      near
        ? Priority.PRIORITY_HIGH_ACCURACY
        : Priority.PRIORITY_BALANCED_POWER_ACCURACY;
    LocationRequest request =
      new LocationRequest.Builder(priority, interval)
        .setMinUpdateIntervalMillis(minInterval)
        .setMinUpdateDistanceMeters(0)
        .setWaitForAccurateLocation(false)
        .build();
    try {
      fused.requestLocationUpdates(request, locationListener, Looper.getMainLooper());
      Log.i(
        TAG,
        "location updates " + (near ? "near/high 1s" : "far/balanced 30s")
      );
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
    nearMode = false;
  }

  /**
   * Cache every FGS fix for the widget face. Paint at most every
   * {@link #WIDGET_REFRESH_MIN_MS} — never 1 Hz in near-mode, never peek fused.
   */
  private static void maybeRefreshWidget(Context context, Location loc) {
    try {
      if (loc != null) {
        com.gateauto.app.widget.WidgetRefresh.rememberFix(context, loc);
      }
      long now = System.currentTimeMillis();
      if (now - lastWidgetRefreshAt < WIDGET_REFRESH_MIN_MS) return;
      lastWidgetRefreshAt = now;
      com.gateauto.app.widget.WidgetRefresh.renderNow(context, loc);
    } catch (Throwable ignored) {
      // Widget package missing in an older prebuild must not break FGS.
    }
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
