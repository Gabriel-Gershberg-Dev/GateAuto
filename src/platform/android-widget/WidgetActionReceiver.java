package com.gateauto.app.widget;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.location.Location;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.gateauto.app.keepalive.KeepAlivePrefs;
import com.gateauto.app.keepalive.PalGateNativeOpen;

import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Widget taps. Explicit, not exported. Calls {@link PalGateNativeOpen#openManual}
 * with source {@code widget} — never pollNearby / setArmed.
 */
public final class WidgetActionReceiver extends BroadcastReceiver {
  public static final String ACTION_OPEN_CLOSEST = "com.gateauto.app.widget.OPEN_CLOSEST";
  public static final String ACTION_OPEN_ID = "com.gateauto.app.widget.OPEN_ID";
  public static final String ACTION_OPEN_APP = "com.gateauto.app.widget.OPEN_APP";
  public static final String EXTRA_ACTION = "action";
  public static final String EXTRA_GATE_ID = "gateId";

  private static final String TAG = "GateAutoWidget";
  private static final AtomicBoolean IN_FLIGHT = new AtomicBoolean(false);
  private static final AtomicInteger EPOCH = new AtomicInteger(0);
  /** Latest queued request while an open is already running; null = closest. */
  private static final AtomicReference<String> QUEUED = new AtomicReference<>(null);
  private static final Object QUEUE_LOCK = new Object();
  private static boolean hasQueued = false;

  @Override
  public void onReceive(Context context, Intent intent) {
    if (intent == null) return;
    final Context app = context.getApplicationContext();
    String action = intent.getStringExtra(EXTRA_ACTION);
    if (action == null || action.isEmpty()) {
      action = intent.getAction();
    }
    if (ACTION_OPEN_APP.equals(action)) {
      openApp(app);
      return;
    }
    if (!KeepAlivePrefs.accountSignedIn(app)) {
      openApp(app);
      return;
    }
    if (!ACTION_OPEN_CLOSEST.equals(action) && !ACTION_OPEN_ID.equals(action)) {
      return;
    }

    final String requested =
      ACTION_OPEN_ID.equals(action) ? intent.getStringExtra(EXTRA_GATE_ID) : null;
    final int epoch = showOpening(app, requested);

    if (!IN_FLIGHT.compareAndSet(false, true)) {
      queueRequest(requested);
      return;
    }

    final PendingResult pending = goAsync();
    new Thread(
      () -> {
        try {
          runOpen(app, requested, epoch);
          while (true) {
            String next;
            synchronized (QUEUE_LOCK) {
              if (!hasQueued) {
                IN_FLIGHT.set(false);
                break;
              }
              hasQueued = false;
              next = QUEUED.getAndSet(null);
            }
            int nextEpoch = showOpening(app, next);
            runOpen(app, next, nextEpoch);
          }
        } catch (Exception e) {
          Log.w(TAG, "widget worker failed", e);
          IN_FLIGHT.set(false);
        } finally {
          try {
            pending.finish();
          } catch (Exception ignored) {
          }
        }
      },
      "gateauto-widget-open"
    ).start();
  }

  /** Paint opening on the main thread before any GPS/open work. Returns the new epoch. */
  private static int showOpening(Context app, String requested) {
    String highlight = requested == null ? "" : requested.trim();
    if (highlight.isEmpty()) {
      try {
        List<WidgetClosest.Ranked> peek =
          WidgetClosest.rank(app, WidgetRefresh.cachedLocation(app));
        if (!peek.isEmpty()) highlight = peek.get(0).id;
      } catch (Exception e) {
        Log.w(TAG, "widget opening highlight failed", e);
      }
    }
    int epoch = EPOCH.incrementAndGet();
    KeepAlivePrefs.setWidgetStatus(app, "opening", "", highlight);
    WidgetRefresh.renderNow(app, WidgetRefresh.cachedLocation(app));
    return epoch;
  }

  private static void queueRequest(String requested) {
    synchronized (QUEUE_LOCK) {
      QUEUED.set(requested);
      hasQueued = true;
    }
  }

  private static void runOpen(Context app, String requested, int epoch) {
    String highlight = requested == null ? "" : requested.trim();
    try {
      Location loc = PalGateNativeOpen.requestCurrentOrLast(app);
      if (loc != null) WidgetRefresh.rememberFix(app, loc, true);
      Location cached = WidgetRefresh.cachedLocation(app);
      List<WidgetClosest.Ranked> ranked = WidgetClosest.rank(app, cached);
      if (cached != null && !ranked.isEmpty()) {
        KeepAlivePrefs.setWidgetLastClosest(app, ranked.get(0).id);
      }
      WidgetClosest.Ranked target = WidgetClosest.pick(ranked, requested);
      if (target == null) {
        if (EPOCH.get() == epoch) {
          KeepAlivePrefs.setWidgetStatus(app, "idle", "", "");
          WidgetRefresh.renderNow(app, cached);
        }
        openApp(app);
        return;
      }
      if (EPOCH.get() != epoch) {
        String err = PalGateNativeOpen.openManual(app, target.id, "widget");
        if (err == null) KeepAlivePrefs.setWidgetLastClosest(app, target.id);
        return;
      }
      KeepAlivePrefs.setWidgetStatus(app, "opening", "", target.id);
      WidgetRefresh.renderNow(app, cached);
      String err = PalGateNativeOpen.openManual(app, target.id, "widget");
      if (EPOCH.get() != epoch) return;
      if (err == null) {
        KeepAlivePrefs.setWidgetLastClosest(app, target.id);
        KeepAlivePrefs.setWidgetStatus(app, "ok", "", target.id);
      } else {
        KeepAlivePrefs.setWidgetStatus(app, "fail", err, target.id);
      }
      WidgetRefresh.renderNow(app, cached);
      final int clearEpoch = epoch;
      new Handler(Looper.getMainLooper())
        .postDelayed(
          () -> {
            if (EPOCH.get() != clearEpoch) return;
            KeepAlivePrefs.setWidgetStatus(app, "idle", "", "");
            WidgetRefresh.renderNow(app, WidgetRefresh.cachedLocation(app));
          },
          1400L
        );
    } catch (Exception e) {
      Log.w(TAG, "widget open failed", e);
      if (EPOCH.get() == epoch) {
        KeepAlivePrefs.setWidgetStatus(app, "fail", "Open failed", highlight);
        WidgetRefresh.renderNow(app, WidgetRefresh.cachedLocation(app));
      }
    }
  }

  static void openApp(Context context) {
    try {
      Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
      if (launch == null) return;
      launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
      context.startActivity(launch);
    } catch (Exception e) {
      Log.w(TAG, "widget open app failed", e);
    }
  }
}
