package com.gateauto.app.keepalive;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import org.json.JSONArray;

import java.util.concurrent.Executor;
import java.util.concurrent.Executors;

import com.gateauto.app.R;

/**
 * The single Auto-open monitoring notice, shared by {@link MonitoringService}
 * (location FGS, foreground) and {@link HoldService} (specialUse process hold).
 * Only one of those runs at a time, so the user always sees one notification
 * with identical wording — the hand-off stays seamless.
 *
 * <p>Two behaviours live here:
 *
 * <p><b>Live status.</b> The text names how many gates are armed and how long
 * ago a check ran ("Monitoring 5 gates · last check 12s ago"), so the notice
 * visibly proves the process is alive instead of showing a static string.
 * {@link #update} re-posts it on the monitoring tick; it is silent
 * (IMPORTANCE_LOW channel + setSilent + setOnlyAlertOnce) so refreshes never
 * buzz.
 *
 * <p><b>Sticky.</b> Android 13+ lets the user swipe an ongoing FGS notification
 * away regardless of setOngoing / FLAG_NO_CLEAR, and dismissing it does not
 * stop the service — which made background monitoring look dead. The delete
 * intent re-posts the notice, but only while monitoring is genuinely armed, the
 * user has not turned the notice off in Settings, and the service that owns
 * that notification id is still running in this process. See {@link #onDismissed}.
 *
 * <p>Freshness rendering: setWhen(lastCheck) + setShowWhen so the header
 * carries the absolute time of the last check, and the body carries the "Xs
 * ago" phrasing refreshed on every tick. setUsesChronometer was evaluated and
 * rejected: on One UI the chronometer replaces the header time with a bare
 * counting-up "0:12" with no label, which reads as monitoring uptime rather
 * than staleness, and it is dropped when the notification is collapsed into a
 * group.
 */
public final class MonitoringNotice {
  private static final String TAG = "GateAutoKeepAlive";

  static final String ACTION_RESTORE = "com.gateauto.app.MONITOR_NOTICE_RESTORE";
  static final String EXTRA_NOTIF_ID = "notifId";

  private static final String TITLE = "GateAuto";
  private static final long JUST_NOW_MS = 10_000L;
  private static final long MINUTE_MS = 60_000L;
  private static final long HOUR_MS = 60L * MINUTE_MS;

  /**
   * A dismissal is user-driven and a re-post cannot itself trigger another
   * delete intent, so restoring cannot loop on its own. This window only
   * exists so an OEM/notification-listener that keeps cancelling us backs off
   * instead of turning into a notify storm.
   */
  private static final long RESTORE_WINDOW_MS = 10_000L;
  private static final int RESTORE_LIMIT = 5;
  private static final long RESTORE_BACKOFF_MS = 60_000L;

  private static long windowStartedAt;
  private static int restoresInWindow;
  private static long backoffUntil;

  /** Single thread: notice updates are serialized and never touch the main looper. */
  private static final Executor WORKER =
    Executors.newSingleThreadExecutor(
      runnable -> {
        Thread thread = new Thread(runnable, "gateauto-notice");
        thread.setDaemon(true);
        return thread;
      }
    );

  private MonitoringNotice() {}

  /** Auto-open-enabled gates the native side is currently watching. */
  public static int armedGateCount(Context context) {
    if (context == null) return 0;
    int count = 0;
    try {
      JSONArray arr = GeofenceRegistrar.regionsArray(context.getApplicationContext());
      for (int i = 0; i < arr.length(); i++) {
        if (GeofenceRegistrar.isAutoEnabled(arr.optJSONObject(i))) count++;
      }
    } catch (Exception ignored) {
      // ignore — a count is never worth failing a notification for
    }
    return count;
  }

  /**
   * Mirrored by {@code src/platform/monitoringNoticeText.ts} and pinned by
   * {@code tests/monitoringNotice.test.ts}.
   */
  static String statusText(int gateCount, long lastCheckMs, long now) {
    String base;
    if (gateCount <= 0) {
      base = "Searching for nearby gates";
    } else if (gateCount == 1) {
      base = "Monitoring 1 gate";
    } else {
      base = "Monitoring " + gateCount + " gates";
    }
    return base + " · " + freshness(lastCheckMs, now);
  }

  private static String freshness(long lastCheckMs, long now) {
    if (lastCheckMs <= 0) return "starting…";
    long age = now - lastCheckMs;
    // Clock moved backwards (NTP / user change) — never render a negative age.
    if (age < 0) age = 0;
    if (age < JUST_NOW_MS) return "last check just now";
    if (age < MINUTE_MS) return "last check " + (age / 1000L) + "s ago";
    if (age < HOUR_MS) return "last check " + (age / MINUTE_MS) + "m ago";
    return "last check " + (age / HOUR_MS) + "h ago";
  }

  /** Current live text, for logging / debugging. */
  public static String currentText(Context context) {
    Context app = context.getApplicationContext();
    return statusText(
      armedGateCount(app),
      KeepAlivePrefs.lastMonitorCheckAt(app),
      System.currentTimeMillis()
    );
  }

  /**
   * @param notifId the id of the FGS that will post this — it goes into the
   *     delete intent so a dismissal can be matched back to its owner.
   */
  public static Notification build(Context context, int notifId) {
    Context app = context.getApplicationContext();
    long lastCheck = KeepAlivePrefs.lastMonitorCheckAt(app);
    long now = System.currentTimeMillis();
    NotificationCompat.Builder builder =
      new NotificationCompat.Builder(app, MonitoringService.CHANNEL_ID)
        .setContentTitle(TITLE)
        .setContentText(statusText(armedGateCount(app), lastCheck, now))
        .setSmallIcon(R.mipmap.ic_launcher)
        .setPriority(NotificationCompat.PRIORITY_LOW)
        .setCategory(NotificationCompat.CATEGORY_SERVICE)
        .setOngoing(true)
        .setAutoCancel(false)
        .setOnlyAlertOnce(true)
        .setSilent(true)
        .setShowWhen(lastCheck > 0)
        .setWhen(lastCheck > 0 ? lastCheck : now)
        .setForegroundServiceBehavior(
          NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE
        )
        .setDeleteIntent(restoreIntent(app, notifId));
    PendingIntent content = launchIntent(app);
    if (content != null) {
      builder.setContentIntent(content);
    }
    Notification notification = builder.build();
    notification.flags |= Notification.FLAG_NO_CLEAR | Notification.FLAG_ONGOING_EVENT;
    return notification;
  }

  /**
   * Required {@code startForeground} (Android 12+ kills the service without
   * it), then detach the shade notice if the user turned it off. Cancelling
   * an FGS notification is ignored on Android 14+ — the system puts it back.
   * {@link Service#stopForeground} with REMOVE is what actually hides it.
   * Auto-open / geofence / BT are unchanged.
   */
  public static void startForegroundHonoringPreference(
      Service service,
      int notifId,
      int fgsType
    ) {
    if (service == null || notifId == 0) return;
    Notification notification = build(service, notifId);
    if (Build.VERSION.SDK_INT >= 34 && fgsType != 0) {
      service.startForeground(notifId, notification, fgsType);
    } else {
      service.startForeground(notifId, notification);
    }
    hideShadeIfDisabled(service, notifId);
  }

  /**
   * After {@code startForeground} (which always needs a notification), honor
   * Settings → hide the shade notice without stopping the service.
   */
  public static void applyUserPreference(Context context) {
    if (context == null) return;
    new Handler(Looper.getMainLooper())
      .post(
        () -> {
          if (MonitoringService.resyncNotice()) return;
          if (HoldService.resyncNotice()) return;
          Context app = context.getApplicationContext();
          WORKER.execute(() -> cancelBoth(app));
        }
      );
  }

  /**
   * Refresh the live text on whichever service currently owns the notice.
   * No-op when not armed or when no monitoring FGS is running in this process,
   * so this can never post a notification the user cannot stop.
   *
   * <p>Always off the caller's thread. Building the notice reads SharedPreferences,
   * parses the gate list and asks the PackageManager for a launch intent; the
   * ticks that drive it run on the main looper, and that is the same looper a
   * cold locked-phone wake needs free to start the process and open a gate.
   */
  public static void update(Context context) {
    if (context == null) return;
    final Context app = context.getApplicationContext();
    if (activeNotifId(app) == 0) return;
    WORKER.execute(
      () -> {
        int id = activeNotifId(app);
        if (id == 0) return;
        post(app, id);
      }
    );
  }

  /**
   * Take the notice down when its owning service is gone. The system already
   * removes a foreground-service notification when the service dies; this also
   * clears the one case that would otherwise linger — an update that was in
   * flight when the service stopped, which would leave a "Monitoring N gates"
   * notice claiming to be alive with nothing behind it.
   */
  static void clearOrphan(Context context, int notifId) {
    if (context == null || notifId == 0) return;
    Context app = context.getApplicationContext();
    if (activeNotifId(app) == notifId) return;
    try {
      NotificationManagerCompat.from(app).cancel(notifId);
    } catch (Exception e) {
      Log.w(TAG, "monitor notice cancel failed", e);
    }
  }

  /**
   * Delete-intent handler: the user swiped the ongoing notice away (Android 13+
   * permits that even for an FGS). Re-post it so monitoring keeps looking as
   * persistent as it actually is.
   *
   * <p>Cannot resurrect a dead notice: the owning service must still be running
   * <em>in this process</em> and Auto-open must still be armed. After the user
   * turns Auto-open off, after the service legitimately stops, or after Stop in
   * Active apps / a force-stop kills the process, the static isRunning flags are
   * false (and pending intents from a stopped package are cancelled), so this
   * returns without posting.
   */
  static void onDismissed(Context context, int dismissedId) {
    if (context == null || dismissedId == 0) return;
    Context app = context.getApplicationContext();
    if (!KeepAlivePrefs.monitorNoticeVisible(app)) {
      Log.i(TAG, "monitor notice dismissed — user hid it, leaving it gone");
      return;
    }
    if (!KeepAlivePrefs.isArmed(app)) {
      Log.i(TAG, "monitor notice dismissed — not armed, leaving it gone");
      return;
    }
    if (dismissedId != activeNotifId(app)) {
      Log.i(TAG, "monitor notice dismissed — owner service gone, leaving it gone");
      return;
    }
    if (!allowRestore(System.currentTimeMillis())) {
      Log.w(TAG, "monitor notice dismissed — restore backoff, skipping");
      return;
    }
    Log.i(TAG, "monitor notice dismissed while armed — restoring");
    post(app, dismissedId);
  }

  /**
   * Mirrored by {@code shouldAllowNoticeRestore} in
   * {@code src/platform/monitoringNoticeText.ts}.
   */
  static synchronized boolean allowRestore(long now) {
    if (backoffUntil > 0 && now < backoffUntil) return false;
    backoffUntil = 0;
    if (windowStartedAt == 0 || now - windowStartedAt > RESTORE_WINDOW_MS) {
      windowStartedAt = now;
      restoresInWindow = 1;
      return true;
    }
    restoresInWindow++;
    if (restoresInWindow > RESTORE_LIMIT) {
      backoffUntil = now + RESTORE_BACKOFF_MS;
      windowStartedAt = 0;
      restoresInWindow = 0;
      return false;
    }
    return true;
  }

  /** The notification id of the monitoring FGS holding the process, or 0. */
  private static int activeNotifId(Context context) {
    if (!KeepAlivePrefs.isArmed(context)) return 0;
    if (MonitoringService.isRunning()) return MonitoringService.NOTIF_ID;
    if (HoldService.isRunning()) return HoldService.NOTIF_ID;
    return 0;
  }

  static void hideShadeIfDisabled(Service service, int notifId) {
    if (service == null || KeepAlivePrefs.monitorNoticeVisible(service)) return;
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
        service.stopForeground(Service.STOP_FOREGROUND_REMOVE);
      } else {
        service.stopForeground(true);
      }
      NotificationManagerCompat.from(service).cancel(notifId);
      Log.i(TAG, "monitor notice hidden by preference; service stays up");
    } catch (Exception e) {
      Log.w(TAG, "monitor notice hide-via-stopForeground failed", e);
    }
  }

  private static void cancelBoth(Context app) {
    try {
      NotificationManagerCompat nm = NotificationManagerCompat.from(app);
      nm.cancel(MonitoringService.NOTIF_ID);
      nm.cancel(HoldService.NOTIF_ID);
    } catch (Exception e) {
      Log.w(TAG, "monitor notice cancel leftover failed", e);
    }
  }

  private static void post(Context app, int notifId) {
    if (!KeepAlivePrefs.monitorNoticeVisible(app)) {
      try {
        NotificationManagerCompat.from(app).cancel(notifId);
      } catch (Exception e) {
        Log.w(TAG, "monitor notice hide failed", e);
      }
      return;
    }
    try {
      Notification notification = build(app, notifId);
      // Re-check after building: if the owning service stopped while we were
      // assembling the notice, posting it now would strand a notification that
      // no foreground service backs and nothing will ever take down.
      if (activeNotifId(app) != notifId) return;
      if (!KeepAlivePrefs.monitorNoticeVisible(app)) return;
      NotificationManagerCompat.from(app).notify(notifId, notification);
    } catch (Exception e) {
      // Missing POST_NOTIFICATIONS etc. — never crash monitoring over a notice.
      Log.w(TAG, "monitor notice post failed", e);
    }
  }

  private static PendingIntent restoreIntent(Context app, int notifId) {
    Intent intent =
      new Intent(app, MonitoringNoticeReceiver.class)
        .setAction(ACTION_RESTORE)
        .putExtra(EXTRA_NOTIF_ID, notifId);
    int flags = PendingIntent.FLAG_UPDATE_CURRENT;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      flags |= PendingIntent.FLAG_IMMUTABLE;
    }
    return PendingIntent.getBroadcast(app, notifId, intent, flags);
  }

  /**
   * Open the phone app ({@code MainActivity}), never {@code CarAppActivity}.
   * {@code getLaunchIntentForPackage} returns CarAppActivity because it is
   * declared first as MAIN/LAUNCHER (AAOS). Tapping the notice then showed
   * Android Auto's "System requires update" / "Check for updates" on the phone.
   */
  private static PendingIntent launchIntent(Context app) {
    Intent launch =
      new Intent(Intent.ACTION_MAIN)
        .setClassName(app.getPackageName(), "com.gateauto.app.MainActivity")
        .addCategory(Intent.CATEGORY_LAUNCHER)
        .addFlags(
          Intent.FLAG_ACTIVITY_NEW_TASK
            | Intent.FLAG_ACTIVITY_CLEAR_TOP
            | Intent.FLAG_ACTIVITY_SINGLE_TOP
            | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED
        );
    int flags = PendingIntent.FLAG_UPDATE_CURRENT;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      flags |= PendingIntent.FLAG_IMMUTABLE;
    }
    // Distinct request code so we do not keep a stale CarAppActivity PI.
    return PendingIntent.getActivity(app, 41031, launch, flags);
  }
}
