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
  /** Wide strip shows this many cubes; extra gates are paged with ‹ ›. */
  static final int CHIPS_PER_PAGE = 3;
  private static final SparseIntArray LAST_STAMP = new SparseIntArray();

  private WidgetRenderer() {}

  static void applyAll(Context context, AppWidgetManager mgr, int[] ids, Location loc) {
    Context localized = localizedContext(context);
    List<WidgetClosest.Ranked> ranked = WidgetClosest.rank(context, loc);
    for (int id : ids) {
      Bundle options = mgr.getAppWidgetOptions(id);
      int layout = pickLayout(options);
      int stamp = layoutStamp(layout, ranked.isEmpty(), KeepAlivePrefs.appLang(context));
      if (layout == R.layout.widget_list
        && LAST_STAMP.get(id, 0) == stamp
        && !ranked.isEmpty()) {
        mgr.notifyAppWidgetViewDataChanged(id, R.id.widget_list_view);
        continue;
      }
      LAST_STAMP.put(id, stamp);
      RemoteViews views = build(localized, context, id, layout, ranked);
      mgr.updateAppWidget(id, views);
      if (layout == R.layout.widget_list && !ranked.isEmpty()) {
        mgr.notifyAppWidgetViewDataChanged(id, R.id.widget_list_view);
      }
    }
  }

  static void forgetWidget(int widgetId) {
    LAST_STAMP.delete(widgetId);
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

  static int chipPageCount(int gateCount) {
    if (gateCount <= 0) return 0;
    return (gateCount + CHIPS_PER_PAGE - 1) / CHIPS_PER_PAGE;
  }

  static int chipPageIndex(int page, int gateCount) {
    int pages = chipPageCount(gateCount);
    if (pages <= 0) return 0;
    if (page < 0) return 0;
    return Math.min(page, pages - 1);
  }

  private static int layoutStamp(int layout, boolean empty, String lang) {
    int h = lang == null ? 0 : lang.hashCode();
    return (layout * 31) ^ (empty ? 1 : 0) ^ (h * 17);
  }

  private static RemoteViews build(
    Context localized,
    Context app,
    int widgetId,
    int layout,
    List<WidgetClosest.Ranked> ranked
  ) {
    RemoteViews views = new RemoteViews(app.getPackageName(), layout);
    String lang = KeepAlivePrefs.appLang(app);
    int dir = "he".equals(lang) ? View.LAYOUT_DIRECTION_RTL : View.LAYOUT_DIRECTION_LTR;
    views.setInt(R.id.widget_root, "setLayoutDirection", dir);

    String status = KeepAlivePrefs.widgetStatus(app);
    String statusMsg = KeepAlivePrefs.widgetStatusMsg(app);
    String openText = openLabel(localized, status, statusMsg);

    if (ranked.isEmpty()) {
      bindEmpty(localized, app, views, layout);
      return views;
    }

    WidgetClosest.Ranked closest = ranked.get(0);
    views.setTextViewText(R.id.widget_eyebrow, localized.getString(R.string.widget_closest));

    if (layout == R.layout.widget_hero) {
      views.setTextViewText(R.id.widget_range, formatRange(localized, closest.meters));
      views.setTextViewText(R.id.widget_name, closest.name);
      views.setTextViewText(R.id.widget_open, openText);
      PendingIntent openClosest = action(app, WidgetActionReceiver.ACTION_OPEN_CLOSEST, null, 72001);
      views.setOnClickPendingIntent(R.id.widget_root, openClosest);
      views.setOnClickPendingIntent(R.id.widget_open, openClosest);
      return views;
    }

    if (layout == R.layout.widget_row) {
      bindChips(localized, app, views, widgetId, ranked, openText);
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
    views.setTextViewText(R.id.widget_range, "");
    views.setTextViewText(R.id.widget_name, localized.getString(R.string.widget_empty));
    views.setTextViewText(R.id.widget_open, localized.getString(R.string.widget_open_app));
    views.setOnClickPendingIntent(R.id.widget_open, openApp);
    if (layout == R.layout.widget_row) {
      views.setViewVisibility(R.id.widget_pager, View.GONE);
      views.setViewVisibility(R.id.widget_chip1, View.GONE);
      views.setViewVisibility(R.id.widget_chip2, View.GONE);
    }
  }

  private static void bindChips(
    Context localized,
    Context app,
    RemoteViews views,
    int widgetId,
    List<WidgetClosest.Ranked> ranked,
    String openText
  ) {
    int pages = chipPageCount(ranked.size());
    int page = chipPageIndex(KeepAlivePrefs.widgetChipPage(app, widgetId), ranked.size());
    KeepAlivePrefs.setWidgetChipPage(app, widgetId, page);
    int start = page * CHIPS_PER_PAGE;
    boolean keepSlotWidth = pages > 1;

    if (pages > 1) {
      views.setViewVisibility(R.id.widget_pager, View.VISIBLE);
      views.setTextViewText(
        R.id.widget_page,
        localized.getString(R.string.widget_page, page + 1, pages)
      );
      int ink = color(localized, R.color.widget_ink);
      int muted = color(localized, R.color.widget_muted);
      views.setTextColor(R.id.widget_page_prev, page <= 0 ? muted : ink);
      views.setTextColor(R.id.widget_page_next, page >= pages - 1 ? muted : ink);
      views.setOnClickPendingIntent(R.id.widget_page_prev, pageAction(app, widgetId, -1));
      views.setOnClickPendingIntent(R.id.widget_page_next, pageAction(app, widgetId, 1));
    } else {
      views.setViewVisibility(R.id.widget_pager, View.GONE);
    }

    int[] chipIds = { R.id.widget_chip0, R.id.widget_chip1, R.id.widget_chip2 };
    int[] nameIds = { R.id.widget_name, R.id.widget_chip1_name, R.id.widget_chip2_name };
    int[] rangeIds = { R.id.widget_range, R.id.widget_chip1_range, R.id.widget_chip2_range };
    int[] openIds = { R.id.widget_open, R.id.widget_chip1_open, R.id.widget_chip2_open };

    for (int i = 0; i < CHIPS_PER_PAGE; i++) {
      int idx = start + i;
      if (idx >= ranked.size()) {
        views.setViewVisibility(chipIds[i], keepSlotWidth ? View.INVISIBLE : View.GONE);
        views.setTextViewText(nameIds[i], "");
        views.setTextViewText(rangeIds[i], "");
        views.setOnClickPendingIntent(chipIds[i], noop(app, 73600 + widgetId * 4 + i));
        views.setOnClickPendingIntent(openIds[i], noop(app, 73601 + widgetId * 4 + i));
        continue;
      }
      WidgetClosest.Ranked row = ranked.get(idx);
      PendingIntent open = idx == 0
        ? action(app, WidgetActionReceiver.ACTION_OPEN_CLOSEST, null, 72001)
        : action(app, WidgetActionReceiver.ACTION_OPEN_ID, row.id, requestCode(row.id));
      views.setViewVisibility(chipIds[i], View.VISIBLE);
      views.setTextViewText(nameIds[i], row.name);
      views.setTextViewText(rangeIds[i], formatRange(localized, row.meters));
      views.setTextViewText(openIds[i], openText);
      views.setOnClickPendingIntent(chipIds[i], open);
      views.setOnClickPendingIntent(openIds[i], open);
    }
  }

  private static void bindList(Context app, RemoteViews views, int widgetId) {
    views.setViewVisibility(R.id.widget_list_empty, View.GONE);
    views.setViewVisibility(R.id.widget_list_view, View.VISIBLE);

    Intent svc = new Intent(app, WidgetViewsService.class);
    svc.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
    svc.setData(Uri.parse("content://com.gateauto.app.widget/views/" + widgetId));
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      views.setRemoteAdapter(R.id.widget_list_view, svc);
    } else {
      views.setRemoteAdapter(widgetId, R.id.widget_list_view, svc);
    }

    Intent template = new Intent(app, WidgetActionReceiver.class);
    template.setAction(WidgetActionReceiver.ACTION_OPEN_ID);
    template.putExtra(WidgetActionReceiver.EXTRA_ACTION, WidgetActionReceiver.ACTION_OPEN_ID);
    template.setData(Uri.parse("content://com.gateauto.app.widget/list/" + widgetId));
    int flags = PendingIntent.FLAG_UPDATE_CURRENT;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      flags |= PendingIntent.FLAG_MUTABLE;
    }
    views.setPendingIntentTemplate(
      R.id.widget_list_view,
      PendingIntent.getBroadcast(app, 74000 + widgetId, template, flags)
    );
  }

  static String openLabel(Context localized, String status, String statusMsg) {
    if ("opening".equals(status)) return localized.getString(R.string.widget_opening);
    if ("ok".equals(status)) return localized.getString(R.string.widget_opened);
    if ("fail".equals(status)) {
      if (statusMsg != null && !statusMsg.trim().isEmpty()) return statusMsg.trim();
      return localized.getString(R.string.widget_open_failed);
    }
    return localized.getString(R.string.widget_open);
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

  private static int color(Context context, int resId) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      return context.getResources().getColor(resId, context.getTheme());
    }
    return context.getResources().getColor(resId);
  }

  private static PendingIntent action(Context context, String action, String gateId, int req) {
    Intent intent = new Intent(context, WidgetActionReceiver.class);
    intent.setAction(action);
    intent.putExtra(WidgetActionReceiver.EXTRA_ACTION, action);
    if (gateId != null) intent.putExtra(WidgetActionReceiver.EXTRA_GATE_ID, gateId);
    return immutableBroadcast(context, req, intent);
  }

  private static PendingIntent pageAction(Context context, int widgetId, int delta) {
    Intent intent = new Intent(context, WidgetActionReceiver.class);
    intent.setAction(WidgetActionReceiver.ACTION_CHIP_PAGE);
    intent.putExtra(WidgetActionReceiver.EXTRA_ACTION, WidgetActionReceiver.ACTION_CHIP_PAGE);
    intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
    intent.putExtra(WidgetActionReceiver.EXTRA_PAGE_DELTA, delta);
    int req = 73500 + widgetId * 4 + (delta < 0 ? 0 : 1);
    return immutableBroadcast(context, req, intent);
  }

  private static PendingIntent noop(Context context, int req) {
    Intent intent = new Intent(context, WidgetActionReceiver.class);
    intent.setAction("com.gateauto.app.widget.NOOP");
    return immutableBroadcast(context, req, intent);
  }

  private static PendingIntent immutableBroadcast(Context context, int req, Intent intent) {
    int flags = PendingIntent.FLAG_UPDATE_CURRENT;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      flags |= PendingIntent.FLAG_IMMUTABLE;
    }
    return PendingIntent.getBroadcast(context, req, intent, flags);
  }

  private static int requestCode(String gateId) {
    return 72100 + (gateId.hashCode() & 0x0fff);
  }
}
