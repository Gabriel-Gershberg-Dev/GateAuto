package com.gateauto.app.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProviderInfo;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.location.Location;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.SparseIntArray;
import android.view.View;
import android.widget.RemoteViews;

import com.gateauto.app.R;
import com.gateauto.app.keepalive.KeepAlivePrefs;

import java.util.List;
import java.util.Locale;

final class WidgetRenderer {
  static final int CHIPS_PER_PAGE_WIDE = 3;
  static final int NARROW_STRIP_MAX_DP = 260;
  private static final SparseIntArray LAST_STRUCTURE = new SparseIntArray();
  private static final SparseIntArray LAST_VISUAL = new SparseIntArray();

  private WidgetRenderer() {}

  static void applyAll(Context context, AppWidgetManager mgr, int[] ids, Location loc) {
    Context localized = localizedContext(context);
    List<WidgetClosest.Ranked> ranked = WidgetClosest.rank(context, loc);
    String lang = KeepAlivePrefs.appLang(context);
    String status = KeepAlivePrefs.widgetStatus(context);
    String gateId = KeepAlivePrefs.widgetStatusGate(context);
    boolean signedIn = KeepAlivePrefs.accountSignedIn(context);
    for (int id : ids) {
      Bundle options = mgr.getAppWidgetOptions(id);
      int layout = pickLayout(options);
      int perPage = layout == R.layout.widget_row ? chipsPerPage(options) : 0;
      int structure = structureStamp(layout, ranked.isEmpty(), lang, perPage, signedIn);
      int visual = visualStamp(status, gateId);
      int prevStructure = LAST_STRUCTURE.get(id, Integer.MIN_VALUE);
      int prevVisual = LAST_VISUAL.get(id, Integer.MIN_VALUE);
      int collectionId = collectionViewId(layout);

      if (prevStructure == structure && !signedIn) {
        continue;
      }

      if (prevStructure == structure && signedIn && !ranked.isEmpty()) {
        if (collectionId != 0) {
          if (prevVisual == visual) {
            continue;
          }
          LAST_VISUAL.put(id, visual);
          mgr.notifyAppWidgetViewDataChanged(id, collectionId);
          continue;
        }
        if (layout == R.layout.widget_hero) {
          if (prevVisual == visual) {
            continue;
          }
          LAST_VISUAL.put(id, visual);
          RemoteViews views = build(localized, context, id, layout, ranked, perPage);
          mgr.updateAppWidget(id, views);
          continue;
        }
      }

      LAST_STRUCTURE.put(id, structure);
      LAST_VISUAL.put(id, visual);
      RemoteViews views = build(localized, context, id, layout, ranked, perPage);
      mgr.updateAppWidget(id, views);
      // Full structure update already setRemoteAdapter — do not also notify
      // (double load flashes the Loading placeholder).
    }
  }

  static void forgetWidget(int widgetId) {
    LAST_STRUCTURE.delete(widgetId);
    LAST_VISUAL.delete(widgetId);
  }

  static int pickLayout(Bundle options) {
    if (options == null) return R.layout.widget_hero;
    int host = options.getInt(
      AppWidgetManager.OPTION_APPWIDGET_HOST_CATEGORY,
      AppWidgetProviderInfo.WIDGET_CATEGORY_HOME_SCREEN
    );
    if (host == AppWidgetProviderInfo.WIDGET_CATEGORY_KEYGUARD) {
      return R.layout.widget_hero;
    }
    int minW = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
    int minH = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0);
    if (minH >= 180) return R.layout.widget_list;
    if (minW >= 220 && minH >= 88) return R.layout.widget_row;
    return R.layout.widget_hero;
  }

  static int chipsPerPage(Bundle options) {
    int minW = options == null
      ? 220
      : options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 220);
    if (minW > 0 && minW < NARROW_STRIP_MAX_DP) return 2;
    return CHIPS_PER_PAGE_WIDE;
  }

  static int chipPageCount(int gateCount, int perPage) {
    int p = Math.max(1, perPage);
    if (gateCount <= 0) return 0;
    return (gateCount + p - 1) / p;
  }

  static int chipPageIndex(int page, int gateCount, int perPage) {
    int pages = chipPageCount(gateCount, perPage);
    if (pages <= 0) return 0;
    if (page < 0) return 0;
    return Math.min(page, pages - 1);
  }

  private static int structureStamp(
    int layout,
    boolean empty,
    String lang,
    int perPage,
    boolean signedIn
  ) {
    int h = lang == null ? 0 : lang.hashCode();
    return (layout * 31)
      ^ (empty ? 1 : 0)
      ^ (h * 17)
      ^ (perPage * 13)
      ^ (signedIn ? 0 : 64);
  }

  private static int visualStamp(String status, String gateId) {
    int s = status == null ? 0 : status.hashCode();
    int g = gateId == null ? 0 : gateId.hashCode();
    return (s * 7) ^ g;
  }

  private static RemoteViews build(
    Context localized,
    Context app,
    int widgetId,
    int layout,
    List<WidgetClosest.Ranked> ranked,
    int perPage
  ) {
    RemoteViews views = new RemoteViews(app.getPackageName(), layout);
    String lang = KeepAlivePrefs.appLang(app);
    int dir = "he".equals(lang) ? View.LAYOUT_DIRECTION_RTL : View.LAYOUT_DIRECTION_LTR;
    views.setInt(R.id.widget_root, "setLayoutDirection", dir);

    if (!KeepAlivePrefs.accountSignedIn(app)) {
      bindSignedOut(localized, app, views, layout);
      return views;
    }

    if (ranked.isEmpty()) {
      bindEmpty(localized, app, views, layout);
      return views;
    }

    WidgetClosest.Ranked closest = ranked.get(0);
    views.setTextViewText(R.id.widget_eyebrow, localized.getString(R.string.widget_closest));

    if (layout == R.layout.widget_hero) {
      views.setTextViewText(R.id.widget_range, formatRange(localized, closest.meters));
      views.setTextViewText(R.id.widget_name, closest.name);
      applyPressState(app, views, closest.id, R.id.widget_hero_chip, R.id.widget_hero_busy);
      PendingIntent openClosest = action(app, WidgetActionReceiver.ACTION_OPEN_CLOSEST, null, 72001);
      views.setOnClickPendingIntent(R.id.widget_root, openClosest);
      views.setOnClickPendingIntent(R.id.widget_hero_chip, openClosest);
      views.setOnClickPendingIntent(R.id.widget_hero_body, openClosest);
      views.setOnClickPendingIntent(R.id.widget_hero_icon, openClosest);
      views.setOnClickPendingIntent(R.id.widget_name, openClosest);
      return views;
    }

    if (layout == R.layout.widget_row) {
      bindStrip(app, views, widgetId, perPage);
      return views;
    }

    bindList(app, views, widgetId);
    return views;
  }

  private static void bindEmpty(Context localized, Context app, RemoteViews views, int layout) {
    views.setTextViewText(R.id.widget_eyebrow, localized.getString(R.string.widget_empty_eyebrow));
    PendingIntent openApp = action(app, WidgetActionReceiver.ACTION_OPEN_APP, null, 72002);
    views.setOnClickPendingIntent(R.id.widget_root, openApp);
    if (layout == R.layout.widget_list) {
      views.setViewVisibility(R.id.widget_list_view, View.GONE);
      views.setViewVisibility(R.id.widget_list_empty, View.VISIBLE);
      views.setOnClickPendingIntent(R.id.widget_list_empty, openApp);
      return;
    }
    if (layout == R.layout.widget_row) {
      views.setViewVisibility(R.id.widget_strip, View.GONE);
      views.setViewVisibility(R.id.widget_row_empty, View.VISIBLE);
      views.setOnClickPendingIntent(R.id.widget_row_empty, openApp);
      return;
    }
    views.setTextViewText(R.id.widget_range, "");
    views.setTextViewText(R.id.widget_name, localized.getString(R.string.widget_empty));
    views.setViewVisibility(R.id.widget_hero_busy, View.GONE);
  }

  /** Gates stay on the phone for Auto-open, but the widget will not open them. */
  private static void bindSignedOut(Context localized, Context app, RemoteViews views, int layout) {
    views.setInt(R.id.widget_root, "setBackgroundResource", R.drawable.widget_face_off);
    views.setTextViewText(R.id.widget_eyebrow, localized.getString(R.string.widget_signed_out));
    views.setTextColor(R.id.widget_eyebrow, localized.getColor(R.color.widget_muted));
    PendingIntent openApp = action(app, WidgetActionReceiver.ACTION_OPEN_APP, null, 72003);
    views.setOnClickPendingIntent(R.id.widget_root, openApp);
    String detail = localized.getString(R.string.widget_signed_out_detail);
    if (layout == R.layout.widget_list) {
      views.setViewVisibility(R.id.widget_list_view, View.GONE);
      views.setViewVisibility(R.id.widget_list_empty, View.VISIBLE);
      views.setTextViewText(R.id.widget_list_empty, detail);
      views.setTextColor(R.id.widget_list_empty, localized.getColor(R.color.widget_muted));
      views.setOnClickPendingIntent(R.id.widget_list_empty, openApp);
      return;
    }
    if (layout == R.layout.widget_row) {
      views.setViewVisibility(R.id.widget_strip, View.GONE);
      views.setViewVisibility(R.id.widget_row_empty, View.VISIBLE);
      views.setTextViewText(R.id.widget_row_empty, detail);
      views.setTextColor(R.id.widget_row_empty, localized.getColor(R.color.widget_muted));
      views.setOnClickPendingIntent(R.id.widget_row_empty, openApp);
      return;
    }
    views.setTextViewText(R.id.widget_range, "");
    views.setTextViewText(R.id.widget_name, detail);
    views.setTextColor(R.id.widget_name, localized.getColor(R.color.widget_muted));
    views.setInt(R.id.widget_hero_chip, "setBackgroundResource", R.drawable.widget_row_well);
    views.setViewVisibility(R.id.widget_hero_busy, View.GONE);
    views.setOnClickPendingIntent(R.id.widget_hero_chip, openApp);
    views.setOnClickPendingIntent(R.id.widget_hero_body, openApp);
    views.setOnClickPendingIntent(R.id.widget_hero_icon, openApp);
    views.setOnClickPendingIntent(R.id.widget_name, openApp);
  }

  private static int collectionViewId(int layout) {
    if (layout == R.layout.widget_list) return R.id.widget_list_view;
    if (layout == R.layout.widget_row) return R.id.widget_strip;
    return 0;
  }

  private static void bindStrip(Context app, RemoteViews views, int widgetId, int perPage) {
    views.setViewVisibility(R.id.widget_row_empty, View.GONE);
    views.setViewVisibility(R.id.widget_strip, View.VISIBLE);
    bindCollection(
      app,
      views,
      widgetId,
      R.id.widget_strip,
      "content://com.gateauto.app.widget/strip/",
      74100,
      Math.max(2, perPage)
    );
  }

  private static void bindList(Context app, RemoteViews views, int widgetId) {
    views.setViewVisibility(R.id.widget_list_empty, View.GONE);
    views.setViewVisibility(R.id.widget_list_view, View.VISIBLE);
    bindCollection(
      app,
      views,
      widgetId,
      R.id.widget_list_view,
      "content://com.gateauto.app.widget/views/",
      74000,
      1
    );
  }

  private static void bindCollection(
    Context app,
    RemoteViews views,
    int widgetId,
    int viewId,
    String uriPrefix,
    int reqBase,
    int cols
  ) {
    Intent svc = new Intent(app, WidgetViewsService.class);
    svc.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
    svc.putExtra(WidgetViewsService.EXTRA_COLS, cols);
    svc.setData(Uri.parse(uriPrefix + widgetId + "/" + cols));
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      views.setRemoteAdapter(viewId, svc);
    } else {
      views.setRemoteAdapter(widgetId, viewId, svc);
    }

    Intent template = new Intent(app, WidgetActionReceiver.class);
    template.setAction(WidgetActionReceiver.ACTION_OPEN_ID);
    template.putExtra(WidgetActionReceiver.EXTRA_ACTION, WidgetActionReceiver.ACTION_OPEN_ID);
    template.setData(Uri.parse(uriPrefix + "tap/" + widgetId));
    int flags = PendingIntent.FLAG_UPDATE_CURRENT;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      flags |= PendingIntent.FLAG_MUTABLE;
    }
    views.setPendingIntentTemplate(
      viewId,
      PendingIntent.getBroadcast(app, reqBase + widgetId, template, flags)
    );
  }

  static void applyPressState(
    Context app,
    RemoteViews views,
    String gateId,
    int chipId,
    int busyId
  ) {
    applyPressState(app, views, gateId, chipId, busyId, false);
  }

  static void applyPressState(
    Context app,
    RemoteViews views,
    String gateId,
    int chipId,
    int busyId,
    boolean imageBg
  ) {
    String status = KeepAlivePrefs.widgetStatus(app);
    String mine = KeepAlivePrefs.widgetStatusGate(app);
    boolean on = gateId != null && !gateId.isEmpty() && gateId.equals(mine);
    int bg = R.drawable.widget_chip;
    int busy = View.GONE;
    if (on) {
      if ("opening".equals(status)) {
        bg = R.drawable.widget_chip_live;
        busy = View.VISIBLE;
      } else if ("ok".equals(status)) {
        bg = R.drawable.widget_chip_ok;
      } else if ("fail".equals(status)) {
        bg = R.drawable.widget_chip_fail;
      }
    }
    if (imageBg) {
      views.setImageViewResource(chipId, bg);
    } else {
      views.setInt(chipId, "setBackgroundResource", bg);
    }
    views.setViewVisibility(busyId, busy);
  }

  static String formatRange(Context localized, Double meters) {
    if (meters == null || !Double.isFinite(meters)) return "";
    if (meters < 1000) {
      return localized.getString(R.string.widget_meters, Math.round(meters));
    }
    String km = String.format(Locale.US, "%.1f", meters / 1000.0);
    return localized.getString(R.string.widget_km, km);
  }

  static Context localizedContext(Context context) {
    String lang = KeepAlivePrefs.appLang(context);
    if (lang == null || lang.isEmpty() || "system".equals(lang)) return context;
    Locale locale = new Locale(lang);
    Configuration conf = new Configuration(context.getResources().getConfiguration());
    conf.setLocale(locale);
    return context.createConfigurationContext(conf);
  }

  private static PendingIntent action(Context context, String action, String gateId, int req) {
    Intent intent = new Intent(context, WidgetActionReceiver.class);
    intent.setAction(action);
    intent.putExtra(WidgetActionReceiver.EXTRA_ACTION, action);
    if (gateId != null) intent.putExtra(WidgetActionReceiver.EXTRA_GATE_ID, gateId);
    int flags = PendingIntent.FLAG_UPDATE_CURRENT;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      flags |= PendingIntent.FLAG_IMMUTABLE;
    }
    return PendingIntent.getBroadcast(context, req, intent, flags);
  }
}
