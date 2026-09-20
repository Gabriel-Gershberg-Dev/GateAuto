package com.gateauto.app.widget;

import android.appwidget.AppWidgetManager;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.location.Location;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.gateauto.app.keepalive.KeepAlivePrefs;

/**
 * Re-render every GateAuto widget. Never starts MonitoringService, ApproachSampler,
 * or flips armed.
 *
 * <p>Display refresh must never call fused {@code getLastLocation} /
 * {@code getCurrentLocation}. Rank from {@link #cachedLocation} (written by
 * MonitoringService location callbacks and a user tap's {@code requestCurrentOrLast})
 * or WidgetClosest last-ranked / lastOpened fallback. Empty cache must not block
 * on Play Services.
 *
 * <p>SCREEN_ON / USER_PRESENT: this receiver is cache-only so Auto-open off still
 * paints. KeepAliveScheduler no longer calls {@link #updateAll} on those actions
 * (avoids a second wake + the old double fused peek). Debounce 1s coalesces
 * SCREEN_ON then USER_PRESENT.
 */
public final class WidgetRefresh {
  private static final String TAG = "GateAutoWidget";
  private static final Handler MAIN = new Handler(Looper.getMainLooper());
  /** Coalesce SCREEN_ON + USER_PRESENT + region-save bursts. */
  private static final long DEBOUNCE_MS = 1_000L;
  /** Near-mode FGS is 1 Hz — do not flush prefs on every tick. */
  private static final long PERSIST_MIN_MS = 10_000L;
  private static volatile boolean screenRegistered;
  private static BroadcastReceiver screenReceiver;
  private static volatile Context pendingApp;
  private static volatile Location memFix;
  private static volatile long lastPersistAt;
  private static final Runnable DEBOUNCED =
    new Runnable() {
      @Override
      public void run() {
        final Context app = pendingApp;
        if (app == null) return;
        renderNow(app, cachedLocation(app));
      }
    };

  private WidgetRefresh() {}

  /**
   * Cheap, cache-only paint. Never peeks fused last-location.
   * No-op when no widget instances exist.
   */
  public static void updateAll(Context context) {
    final Context app = context.getApplicationContext();
    if (!hasWidgets(app)) {
      releaseScreenReceiver(app);
      return;
    }
    ensureScreenReceiver(app);
    pendingApp = app;
    MAIN.removeCallbacks(DEBOUNCED);
    MAIN.postDelayed(DEBOUNCED, DEBOUNCE_MS);
  }

  /**
   * Remember a fix the caller already has. Display paths must not obtain this
   * via fused getLastLocation / getCurrentLocation.
   */
  public static void rememberFix(Context context, Location loc) {
    rememberFix(context, loc, false);
  }

  public static void rememberFix(Context context, Location loc, boolean persistNow) {
    if (loc == null) return;
    if (!Double.isFinite(loc.getLatitude()) || !Double.isFinite(loc.getLongitude())) {
      return;
    }
    memFix = new Location(loc);
    long now = System.currentTimeMillis();
    if (!persistNow && now - lastPersistAt < PERSIST_MIN_MS) return;
    lastPersistAt = now;
    KeepAlivePrefs.setWidgetLastFix(
      context.getApplicationContext(),
      loc.getLatitude(),
      loc.getLongitude(),
      loc.getTime() > 0 ? loc.getTime() : now
    );
  }

  /** In-memory fix, else persisted cache. Never queries Play Services. */
  public static Location cachedLocation(Context context) {
    Location mem = memFix;
    if (mem != null) return mem;
    return KeepAlivePrefs.widgetLastFix(context.getApplicationContext());
  }

  /** Immediate paint. Writes {@code loc} into the cache when non-null. */
  public static void renderNow(Context context, Location loc) {
    Context app = context.getApplicationContext();
    if (loc != null) rememberFix(app, loc);
    Location paint = loc != null ? loc : cachedLocation(app);
    try {
      AppWidgetManager mgr = AppWidgetManager.getInstance(app);
      ComponentName name = new ComponentName(app, GateAutoWidgetProvider.class);
      int[] ids = mgr.getAppWidgetIds(name);
      if (ids == null || ids.length == 0) return;
      WidgetRenderer.applyAll(app, mgr, ids, paint);
    } catch (Exception e) {
      Log.w(TAG, "widget render failed", e);
    }
  }

  public static synchronized void ensureScreenReceiver(Context context) {
    if (screenRegistered) return;
    final Context app = context.getApplicationContext();
    if (!hasWidgets(app)) return;
    screenReceiver =
      new BroadcastReceiver() {
        @Override
        public void onReceive(Context ctx, Intent intent) {
          if (intent == null) return;
          String action = intent.getAction();
          if (!Intent.ACTION_SCREEN_ON.equals(action)
            && !Intent.ACTION_USER_PRESENT.equals(action)) {
            return;
          }
          updateAll(app);
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
      Log.w(TAG, "widget screen receiver failed", e);
    }
  }

  public static synchronized void releaseScreenReceiver(Context context) {
    if (!screenRegistered || screenReceiver == null) return;
    try {
      context.getApplicationContext().unregisterReceiver(screenReceiver);
    } catch (Exception ignored) {
      // already gone
    }
    screenRegistered = false;
    screenReceiver = null;
  }

  private static boolean hasWidgets(Context app) {
    try {
      AppWidgetManager mgr = AppWidgetManager.getInstance(app);
      int[] ids =
        mgr.getAppWidgetIds(new ComponentName(app, GateAutoWidgetProvider.class));
      return ids != null && ids.length > 0;
    } catch (Exception e) {
      return false;
    }
  }
}
