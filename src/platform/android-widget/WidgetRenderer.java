package com.gateauto.app.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProviderInfo;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.location.Location;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;

import com.gateauto.app.R;
import com.gateauto.app.keepalive.KeepAlivePrefs;

import java.util.List;
import java.util.Locale;

final class WidgetRenderer {
  private static final int EXTRA_CHIPS = 2;

  private WidgetRenderer() {}

  static void applyAll(Context context, AppWidgetManager mgr, int[] ids, Location loc) {
    Context localized = localizedContext(context);
    List<WidgetClosest.Ranked> ranked = WidgetClosest.rank(context, loc);
    for (int id : ids) {
      Bundle options = mgr.getAppWidgetOptions(id);
      int layout = pickLayout(options);
      RemoteViews views = build(localized, context, layout, ranked, listSlotCount(options));
      mgr.updateAppWidget(id, views);
    }
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

  /** How many list rows can stay ≥48dp. Extra height adds rows; never cram five skinny ones. */
  static int listSlotCount(Bundle options) {
    int minH = options == null
      ? 180
      : options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 180);
    int n = (minH - 28) / 52;
    if (n < 3) n = 3;
    if (n > 5) n = 5;
    return n;
  }

  private static RemoteViews build(
    Context localized,
    Context app,
    int layout,
    List<WidgetClosest.Ranked> ranked,
    int listSlots
  ) {
    RemoteViews views = new RemoteViews(app.getPackageName(), layout);
    String lang = KeepAlivePrefs.appLang(app);
    int dir = "he".equals(lang) ? View.LAYOUT_DIRECTION_RTL : View.LAYOUT_DIRECTION_LTR;
    views.setInt(R.id.widget_root, "setLayoutDirection", dir);

    String status = KeepAlivePrefs.widgetStatus(app);
    String statusMsg = KeepAlivePrefs.widgetStatusMsg(app);
    String openText = openLabel(localized, status, statusMsg);

    if (ranked.isEmpty()) {
      views.setTextViewText(R.id.widget_eyebrow, localized.getString(R.string.widget_empty_eyebrow));
      views.setTextViewText(R.id.widget_range, "");
      views.setTextViewText(R.id.widget_name, localized.getString(R.string.widget_empty));
      views.setTextViewText(R.id.widget_open, localized.getString(R.string.widget_open_app));
      PendingIntent openApp = action(app, WidgetActionReceiver.ACTION_OPEN_APP, null, 72002);
      views.setOnClickPendingIntent(R.id.widget_root, openApp);
      views.setOnClickPendingIntent(R.id.widget_open, openApp);
      hideExtras(views, layout);
      return views;
    }

    WidgetClosest.Ranked closest = ranked.get(0);
    views.setTextViewText(R.id.widget_eyebrow, localized.getString(R.string.widget_closest));
    views.setTextViewText(R.id.widget_range, formatRange(localized, closest.meters));
    views.setTextViewText(R.id.widget_name, closest.name);
    views.setTextViewText(R.id.widget_open, openText);
    PendingIntent openClosest = action(app, WidgetActionReceiver.ACTION_OPEN_CLOSEST, null, 72001);

    if (layout == R.layout.widget_hero) {
      views.setOnClickPendingIntent(R.id.widget_root, openClosest);
      views.setOnClickPendingIntent(R.id.widget_open, openClosest);
      return views;
    }

    if (layout == R.layout.widget_row) {
      bindChips(localized, app, views, ranked, openClosest, openText);
      return views;
    }

    bindList(localized, app, views, ranked, openClosest, openText, listSlots);
    return views;
  }

  private static void hideExtras(RemoteViews views, int layout) {
    if (layout == R.layout.widget_row) {
      views.setViewVisibility(R.id.widget_chip1, View.GONE);
      views.setViewVisibility(R.id.widget_chip2, View.GONE);
    } else if (layout == R.layout.widget_list) {
      int[] rows = { R.id.widget_row1, R.id.widget_row2, R.id.widget_row3, R.id.widget_row4 };
      for (int row : rows) views.setViewVisibility(row, View.GONE);
    }
  }

  private static void bindChips(
    Context localized,
    Context app,
    RemoteViews views,
    List<WidgetClosest.Ranked> ranked,
    PendingIntent openClosest,
    String openText
  ) {
    views.setOnClickPendingIntent(R.id.widget_chip0, openClosest);
    views.setOnClickPendingIntent(R.id.widget_open, openClosest);

    int[] chipIds = { R.id.widget_chip1, R.id.widget_chip2 };
    int[] nameIds = { R.id.widget_chip1_name, R.id.widget_chip2_name };
    int[] rangeIds = { R.id.widget_chip1_range, R.id.widget_chip2_range };
    int[] openIds = { R.id.widget_chip1_open, R.id.widget_chip2_open };
    for (int i = 0; i < EXTRA_CHIPS; i++) {
      int idx = i + 1;
      if (idx >= ranked.size()) {
        views.setViewVisibility(chipIds[i], View.GONE);
        continue;
      }
      WidgetClosest.Ranked row = ranked.get(idx);
      PendingIntent open = action(app, WidgetActionReceiver.ACTION_OPEN_ID, row.id, requestCode(row.id));
      views.setViewVisibility(chipIds[i], View.VISIBLE);
      views.setTextViewText(nameIds[i], row.name);
      views.setTextViewText(rangeIds[i], formatRange(localized, row.meters));
      views.setTextViewText(openIds[i], openText);
      views.setOnClickPendingIntent(chipIds[i], open);
      views.setOnClickPendingIntent(openIds[i], open);
    }
  }

  private static void bindList(
    Context localized,
    Context app,
    RemoteViews views,
    List<WidgetClosest.Ranked> ranked,
    PendingIntent openClosest,
    String openText,
    int listSlots
  ) {
    views.setOnClickPendingIntent(R.id.widget_row0, openClosest);
    views.setOnClickPendingIntent(R.id.widget_open, openClosest);

    int[] rowIds = { R.id.widget_row1, R.id.widget_row2, R.id.widget_row3, R.id.widget_row4 };
    int[] nameIds = {
      R.id.widget_row1_name, R.id.widget_row2_name, R.id.widget_row3_name, R.id.widget_row4_name
    };
    int[] rangeIds = {
      R.id.widget_row1_range, R.id.widget_row2_range, R.id.widget_row3_range, R.id.widget_row4_range
    };
    int[] openIds = {
      R.id.widget_row1_open, R.id.widget_row2_open, R.id.widget_row3_open, R.id.widget_row4_open
    };
    int extraSlots = Math.max(0, listSlots - 1);
    for (int i = 0; i < rowIds.length; i++) {
      int idx = i + 1;
      if (i >= extraSlots || idx >= ranked.size()) {
        views.setViewVisibility(rowIds[i], View.GONE);
        continue;
      }
      WidgetClosest.Ranked row = ranked.get(idx);
      PendingIntent open = action(app, WidgetActionReceiver.ACTION_OPEN_ID, row.id, requestCode(row.id));
      views.setViewVisibility(rowIds[i], View.VISIBLE);
      views.setTextViewText(nameIds[i], row.name);
      views.setTextViewText(rangeIds[i], formatRange(localized, row.meters));
      views.setTextViewText(openIds[i], openText);
      views.setOnClickPendingIntent(rowIds[i], open);
      views.setOnClickPendingIntent(openIds[i], open);
    }
  }

  private static String openLabel(Context localized, String status, String statusMsg) {
    if ("opening".equals(status)) return localized.getString(R.string.widget_opening);
    if ("ok".equals(status)) return localized.getString(R.string.widget_opened);
    if ("fail".equals(status)) {
      if (statusMsg != null && !statusMsg.trim().isEmpty()) return statusMsg.trim();
      return localized.getString(R.string.widget_open_failed);
    }
    return localized.getString(R.string.widget_open);
  }

  private static String formatRange(Context localized, Double meters) {
    if (meters == null || !Double.isFinite(meters)) return "";
    if (meters < 1000) {
      return localized.getString(R.string.widget_meters, Math.round(meters));
    }
    String km = String.format(Locale.US, "%.1f", meters / 1000.0);
    return localized.getString(R.string.widget_km, km);
  }

  private static Context localizedContext(Context context) {
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

  private static int requestCode(String gateId) {
    return 72100 + (gateId.hashCode() & 0x0fff);
  }
}
