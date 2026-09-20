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
    if (!ACTION_OPEN_CLOSEST.equals(action) && !ACTION_OPEN_ID.equals(action)) {
      return;
    }
    if (!IN_FLIGHT.compareAndSet(false, true)) return;
    final String requested =
      ACTION_OPEN_ID.equals(action) ? intent.getStringExtra(EXTRA_GATE_ID) : null;
    new Thread(
      () -> {
        try {
          KeepAlivePrefs.setWidgetStatus(app, "opening", "");
          WidgetRefresh.renderNow(app, WidgetRefresh.cachedLocation(app));
          Location loc = PalGateNativeOpen.requestCurrentOrLast(app);
          if (loc != null) WidgetRefresh.rememberFix(app, loc, true);
          List<WidgetClosest.Ranked> ranked = WidgetClosest.rank(app, loc);
          if (loc != null && !ranked.isEmpty()) {
            KeepAlivePrefs.setWidgetLastClosest(app, ranked.get(0).id);
          }
          WidgetClosest.Ranked target = WidgetClosest.pick(ranked, requested);
          if (target == null) {
            KeepAlivePrefs.setWidgetStatus(app, "idle", "");
            WidgetRefresh.renderNow(app, loc);
            openApp(app);
            return;
          }
          String err = PalGateNativeOpen.openManual(app, target.id, "widget");
          if (err == null) {
            KeepAlivePrefs.setWidgetLastClosest(app, target.id);
            KeepAlivePrefs.setWidgetStatus(app, "ok", "");
          } else {
            KeepAlivePrefs.setWidgetStatus(app, "fail", err);
          }
          WidgetRefresh.renderNow(app, loc);
          new Handler(Looper.getMainLooper())
            .postDelayed(
              () -> {
                KeepAlivePrefs.setWidgetStatus(app, "idle", "");
                WidgetRefresh.updateAll(app);
              },
              3500L
            );
        } catch (Exception e) {
          Log.w(TAG, "widget open failed", e);
          KeepAlivePrefs.setWidgetStatus(app, "fail", "Open failed");
          WidgetRefresh.updateAll(app);
        } finally {
          IN_FLIGHT.set(false);
        }
      },
      "gateauto-widget-open"
    ).start();
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
