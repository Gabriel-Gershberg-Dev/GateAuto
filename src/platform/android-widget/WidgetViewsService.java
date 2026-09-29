package com.gateauto.app.widget;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.location.Location;
import android.util.Log;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import com.gateauto.app.R;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Collection rows for the tall list (one cube) and the wide strip
 * (two or three cubes). Rank from {@link WidgetRefresh#cachedLocation} only.
 *
 * <p>The wide strip is a ListView of horizontal lines, not a GridView —
 * Samsung home leaves GridView on the default loading placeholder.
 */
public class WidgetViewsService extends RemoteViewsService {
  static final String EXTRA_COLS = "cols";
  private static final String TAG = "GateAutoWidget";

  @Override
  public RemoteViewsFactory onGetViewFactory(Intent intent) {
    int cols = intent == null ? 1 : intent.getIntExtra(EXTRA_COLS, 1);
    return new Factory(getApplicationContext(), Math.max(1, cols));
  }

  static final class Factory implements RemoteViewsFactory {
    /** root, bg, body, name, range, busy */
    private static final int[][] SLOTS = {
      {
        R.id.widget_slot_0,
        R.id.widget_slot_0_bg,
        R.id.widget_slot_0_body,
        R.id.widget_slot_0_name,
        R.id.widget_slot_0_range,
        R.id.widget_slot_0_busy
      },
      {
        R.id.widget_slot_1,
        R.id.widget_slot_1_bg,
        R.id.widget_slot_1_body,
        R.id.widget_slot_1_name,
        R.id.widget_slot_1_range,
        R.id.widget_slot_1_busy
      },
      {
        R.id.widget_slot_2,
        R.id.widget_slot_2_bg,
        R.id.widget_slot_2_body,
        R.id.widget_slot_2_name,
        R.id.widget_slot_2_range,
        R.id.widget_slot_2_busy
      }
    };

    private final Context app;
    private final int cols;
    private List<WidgetClosest.Ranked> ranked = Collections.emptyList();

    Factory(Context app, int cols) {
      this.app = app.getApplicationContext();
      this.cols = Math.min(3, Math.max(1, cols));
    }

    @Override
    public void onCreate() {}

    @Override
    public void onDataSetChanged() {
      try {
        Location loc = WidgetRefresh.cachedLocation(app);
        List<WidgetClosest.Ranked> next = WidgetClosest.rank(app, loc);
        ranked = next == null ? Collections.emptyList() : new ArrayList<>(next);
      } catch (Exception e) {
        Log.w(TAG, "widget factory rank failed", e);
        ranked = Collections.emptyList();
      }
    }

    @Override
    public void onDestroy() {
      ranked = Collections.emptyList();
    }

    @Override
    public int getCount() {
      if (ranked.isEmpty()) return 0;
      if (cols <= 1) return ranked.size();
      return (ranked.size() + cols - 1) / cols;
    }

    @Override
    public RemoteViews getViewAt(int position) {
      try {
        if (cols <= 1) return bindCube(position);
        return bindLine(position);
      } catch (Exception e) {
        Log.w(TAG, "widget factory view failed", e);
        return new RemoteViews(
          app.getPackageName(),
          cols <= 1 ? R.layout.widget_cube : R.layout.widget_strip_line
        );
      }
    }

    private RemoteViews bindCube(int position) {
      RemoteViews views = new RemoteViews(app.getPackageName(), R.layout.widget_cube);
      if (position < 0 || position >= ranked.size()) return views;
      bindGate(
        views,
        ranked.get(position),
        R.id.widget_cube,
        R.id.widget_cube_bg,
        R.id.widget_cube_body,
        R.id.widget_cube_name,
        R.id.widget_cube_range,
        R.id.widget_cube_busy
      );
      return views;
    }

    private RemoteViews bindLine(int position) {
      RemoteViews line = new RemoteViews(app.getPackageName(), R.layout.widget_strip_line);
      int start = position * cols;
      for (int i = 0; i < SLOTS.length; i++) {
        int idx = start + i;
        if (i >= cols || idx >= ranked.size()) {
          line.setViewVisibility(SLOTS[i][0], View.GONE);
          continue;
        }
        line.setViewVisibility(SLOTS[i][0], View.VISIBLE);
        bindGate(
          line,
          ranked.get(idx),
          SLOTS[i][0],
          SLOTS[i][1],
          SLOTS[i][2],
          SLOTS[i][3],
          SLOTS[i][4],
          SLOTS[i][5]
        );
      }
      return line;
    }

    private void bindGate(
      RemoteViews views,
      WidgetClosest.Ranked row,
      int rootId,
      int bgId,
      int bodyId,
      int nameId,
      int rangeId,
      int busyId
    ) {
      Context localized = WidgetRenderer.localizedContext(app);
      views.setTextViewText(nameId, row.name);
      views.setTextViewText(rangeId, WidgetRenderer.formatRange(localized, row.meters));
      WidgetRenderer.applyPressState(app, views, row.id, bgId, busyId, true);
      // Samsung home delivers the tap to the hit child; each needs its own fill-in.
      views.setOnClickFillInIntent(rootId, fillIn(row.id));
      views.setOnClickFillInIntent(bgId, fillIn(row.id));
      views.setOnClickFillInIntent(bodyId, fillIn(row.id));
      views.setOnClickFillInIntent(nameId, fillIn(row.id));
      views.setOnClickFillInIntent(rangeId, fillIn(row.id));
      views.setOnClickFillInIntent(busyId, fillIn(row.id));
    }

    private static Intent fillIn(String gateId) {
      Intent fill = new Intent();
      fill.putExtra(WidgetActionReceiver.EXTRA_ACTION, WidgetActionReceiver.ACTION_OPEN_ID);
      fill.putExtra(WidgetActionReceiver.EXTRA_GATE_ID, gateId);
      return fill;
    }

    @Override
    public RemoteViews getLoadingView() {
      return new RemoteViews(
        app.getPackageName(),
        cols <= 1 ? R.layout.widget_cube : R.layout.widget_strip_line
      );
    }

    @Override
    public int getViewTypeCount() {
      return 1;
    }

    @Override
    public long getItemId(int position) {
      return position;
    }

    @Override
    public boolean hasStableIds() {
      return true;
    }
  }
}
