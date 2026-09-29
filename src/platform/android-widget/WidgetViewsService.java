package com.gateauto.app.widget;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.location.Location;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import com.gateauto.app.R;
import com.gateauto.app.keepalive.KeepAlivePrefs;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Tall widget collection. Cubes keep wrap_content height; ListView scrolls
 * only when they do not fit. Ranks from {@link WidgetRefresh#cachedLocation}
 * — never fused getLastLocation.
 */
public class WidgetViewsService extends RemoteViewsService {
  @Override
  public RemoteViewsFactory onGetViewFactory(Intent intent) {
    int widgetId = intent == null
      ? AppWidgetManager.INVALID_APPWIDGET_ID
      : intent.getIntExtra(
        AppWidgetManager.EXTRA_APPWIDGET_ID,
        AppWidgetManager.INVALID_APPWIDGET_ID
      );
    return new Factory(getApplicationContext(), widgetId);
  }

  static final class Factory implements RemoteViewsFactory {
    private final Context app;
    private List<WidgetClosest.Ranked> ranked = Collections.emptyList();

    Factory(Context app, int ignoredWidgetId) {
      this.app = app.getApplicationContext();
    }

    @Override
    public void onCreate() {}

    @Override
    public void onDataSetChanged() {
      Location loc = WidgetRefresh.cachedLocation(app);
      List<WidgetClosest.Ranked> next = WidgetClosest.rank(app, loc);
      ranked = next == null ? Collections.emptyList() : new ArrayList<>(next);
    }

    @Override
    public void onDestroy() {
      ranked = Collections.emptyList();
    }

    @Override
    public int getCount() {
      return ranked.size();
    }

    @Override
    public RemoteViews getViewAt(int position) {
      RemoteViews views = new RemoteViews(app.getPackageName(), R.layout.widget_cube);
      if (position < 0 || position >= ranked.size()) return views;
      Context localized = WidgetRenderer.localizedContext(app);
      WidgetClosest.Ranked row = ranked.get(position);
      String status = KeepAlivePrefs.widgetStatus(app);
      String statusMsg = KeepAlivePrefs.widgetStatusMsg(app);
      views.setTextViewText(R.id.widget_cube_name, row.name);
      views.setTextViewText(R.id.widget_cube_range, WidgetRenderer.formatRange(localized, row.meters));
      views.setTextViewText(R.id.widget_cube_open, WidgetRenderer.openLabel(localized, status, statusMsg));
      Intent fill = new Intent();
      fill.putExtra(WidgetActionReceiver.EXTRA_ACTION, WidgetActionReceiver.ACTION_OPEN_ID);
      fill.putExtra(WidgetActionReceiver.EXTRA_GATE_ID, row.id);
      views.setOnClickFillInIntent(R.id.widget_cube, fill);
      views.setOnClickFillInIntent(R.id.widget_cube_open, fill);
      return views;
    }

    @Override
    public RemoteViews getLoadingView() {
      return null;
    }

    @Override
    public int getViewTypeCount() {
      return 1;
    }

    @Override
    public long getItemId(int position) {
      if (position < 0 || position >= ranked.size()) return position;
      return ranked.get(position).id.hashCode();
    }

    @Override
    public boolean hasStableIds() {
      return false;
    }
  }
}
