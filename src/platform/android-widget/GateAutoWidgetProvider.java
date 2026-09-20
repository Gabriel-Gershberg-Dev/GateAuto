package com.gateauto.app.widget;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.os.Bundle;

/** Resizeable closest-pinned-gate widget. Layout is chosen from the size bucket. */
public class GateAutoWidgetProvider extends AppWidgetProvider {
  @Override
  public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
    WidgetRefresh.updateAll(context);
  }

  @Override
  public void onAppWidgetOptionsChanged(
    Context context,
    AppWidgetManager appWidgetManager,
    int appWidgetId,
    Bundle newOptions
  ) {
    WidgetRefresh.updateAll(context);
  }

  @Override
  public void onEnabled(Context context) {
    WidgetRefresh.ensureScreenReceiver(context);
    WidgetRefresh.updateAll(context);
  }

  @Override
  public void onDisabled(Context context) {
    WidgetRefresh.releaseScreenReceiver(context);
  }
}
