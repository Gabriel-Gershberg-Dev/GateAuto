package com.gateauto.app.car;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.car.app.CarContext;
import androidx.car.app.CarToast;
import androidx.car.app.Screen;
import androidx.car.app.model.Action;
import androidx.car.app.model.ActionStrip;
import androidx.car.app.model.CarColor;
import androidx.car.app.model.CarIcon;
import androidx.car.app.model.GridItem;
import androidx.car.app.model.GridTemplate;
import androidx.car.app.model.ItemList;
import androidx.car.app.model.ListTemplate;
import androidx.car.app.model.MessageTemplate;
import androidx.car.app.model.Row;
import androidx.car.app.model.Template;
import androidx.core.graphics.drawable.IconCompat;
import androidx.lifecycle.DefaultLifecycleObserver;
import androidx.lifecycle.LifecycleOwner;

import com.gateauto.app.R;
import com.gateauto.app.keepalive.GeofenceRegistrar;
import com.gateauto.app.keepalive.KeepAliveModule;
import com.gateauto.app.keepalive.KeepAlivePrefs;
import com.gateauto.app.keepalive.PalGateNativeOpen;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;

/**
 * One car home: GridTemplate or ListTemplate. Header ActionStrip is Auto-open
 * On/Off (the one titled action) plus an icon-only List/Grid switch.
 */
public class GateAutoCarScreen extends Screen {
  private static final String TAG = "GateAutoCar";
  private static final int NAME_MAX_GRID = 20;
  private static final int NAME_MAX_LIST = 24;
  private static final long RESTORE_MS = 1800L;
  private static final Executor OPEN_EXEC = Executors.newSingleThreadExecutor();

  /** Day teal / brighter night so glyphs pop on dark host chrome. */
  static final CarColor HUD_TEAL = CarColor.createCustom(0xFF3AA99C, 0xFF5ECFC0);

  private enum Tile {
    IDLE,
    OPENING,
    OPENED
  }

  private static final class GateEntry {
    final String id;
    final String name;

    GateEntry(String id, String name) {
      this.id = id;
      this.name = name;
    }
  }

  private final Handler handler = new Handler(Looper.getMainLooper());
  private final Map<String, Tile> tiles = new HashMap<>();
  private volatile boolean active = true;
  private Template lastTemplate;

  public GateAutoCarScreen(@NonNull CarContext carContext) {
    super(carContext);
    getLifecycle()
      .addObserver(
        new DefaultLifecycleObserver() {
          @Override
          public void onDestroy(@NonNull LifecycleOwner owner) {
            active = false;
            handler.removeCallbacksAndMessages(null);
          }
        }
      );
  }

  @NonNull
  static String truncateName(String name, int max) {
    if (name == null) return "Gate";
    String t = name.trim();
    if (t.isEmpty()) return "Gate";
    if (t.length() <= max) return t;
    return t.substring(0, Math.max(1, max - 3)).trim() + "...";
  }

  @NonNull
  @Override
  public Template onGetTemplate() {
    try {
      lastTemplate = buildTemplate();
      return lastTemplate;
    } catch (RuntimeException e) {
      Log.e(TAG, "onGetTemplate failed", e);
      if (lastTemplate != null) return lastTemplate;
      try {
        Template fallback = buildSafeGridIfGatesExist();
        if (fallback != null) {
          lastTemplate = fallback;
          return fallback;
        }
      } catch (RuntimeException e2) {
        Log.e(TAG, "safe grid fallback failed", e2);
      }
      return new MessageTemplate.Builder(
          "Could not load gates. Open GateAuto on the phone and try again."
        )
        .setTitle("GateAuto")
        .setHeaderAction(Action.APP_ICON)
        .build();
    }
  }

  @NonNull
  private Template buildTemplate() {
    boolean armed = KeepAlivePrefs.isArmed(getCarContext());
    boolean listLayout = KeepAlivePrefs.isCarListLayout(getCarContext());
    String title = armed ? "GateAuto" : "Auto-open off";
    List<GateEntry> gates = loadGates();
    ActionStrip fullStrip = makeStrip(armed, listLayout, true);
    ActionStrip autoOnly = makeStrip(armed, listLayout, false);

    if (gates.isEmpty()) {
      try {
        return emptyTemplate(title, fullStrip);
      } catch (RuntimeException e) {
        Log.w(TAG, "empty template with layout switch failed", e);
        return emptyTemplate(title, autoOnly);
      }
    }

    RuntimeException last = new IllegalStateException("preferred template with layout switch failed");
    Template built = tryHome(listLayout, title, gates, fullStrip);
    if (built != null) return built;
    built = tryHome(listLayout, title, gates, autoOnly);
    if (built != null) return built;
    built = tryHome(!listLayout, title, gates, fullStrip);
    if (built != null) return built;
    built = tryHome(!listLayout, title, gates, autoOnly);
    if (built != null) return built;
    try {
      return gridTemplate(title, gates, autoOnly);
    } catch (RuntimeException e) {
      throw last;
    }
  }

  @Nullable
  private Template tryHome(
      boolean list,
      String title,
      List<GateEntry> gates,
      ActionStrip strip
    ) {
    try {
      return list ? listTemplate(title, gates, strip) : gridTemplate(title, gates, strip);
    } catch (RuntimeException e) {
      Log.w(TAG, (list ? "list" : "grid") + " template failed", e);
      return null;
    }
  }

  @Nullable
  private Template buildSafeGridIfGatesExist() {
    List<GateEntry> gates = loadGates();
    if (gates.isEmpty()) return null;
    boolean armed = KeepAlivePrefs.isArmed(getCarContext());
    String title = armed ? "GateAuto" : "Auto-open off";
    return gridTemplate(title, gates, makeStrip(armed, false, false));
  }

  @NonNull
  private Template emptyTemplate(String title, ActionStrip strip) {
    return new MessageTemplate.Builder(
        "No gates yet. Open GateAuto on your phone, link PalGate, then come back."
      )
      .setTitle(title)
      .setHeaderAction(Action.APP_ICON)
      .setActionStrip(strip)
      .build();
  }

  @NonNull
  private Template listTemplate(String title, List<GateEntry> gates, ActionStrip strip) {
    ItemList.Builder list = new ItemList.Builder();
    for (GateEntry gate : gates) {
      list.addItem(gateRow(gate));
    }
    return new ListTemplate.Builder()
      .setTitle(title)
      .setHeaderAction(Action.APP_ICON)
      .setActionStrip(strip)
      .setSingleList(list.build())
      .build();
  }

  @NonNull
  private Template gridTemplate(String title, List<GateEntry> gates, ActionStrip strip) {
    ItemList.Builder grid = new ItemList.Builder();
    for (GateEntry gate : gates) {
      grid.addItem(gateItem(gate, GridItem.IMAGE_TYPE_ICON));
    }
    GridTemplate.Builder b =
      new GridTemplate.Builder()
        .setTitle(title)
        .setHeaderAction(Action.APP_ICON)
        .setSingleList(grid.build());
    if (strip != null) b.setActionStrip(strip);
    return b.build();
  }

  private ActionStrip makeStrip(boolean armed, boolean listLayout, boolean includeLayout) {
    ActionStrip.Builder b = new ActionStrip.Builder().addAction(autoOpenAction(armed));
    if (includeLayout) b.addAction(layoutAction(listLayout));
    return b.build();
  }

  @NonNull
  private List<GateEntry> loadGates() {
    List<GateEntry> out = new ArrayList<>();
    JSONArray gates = GeofenceRegistrar.regionsArray(getCarContext());
    if (gates == null) return out;
    for (int i = 0; i < gates.length(); i++) {
      JSONObject gate = gates.optJSONObject(i);
      if (gate == null) continue;
      String id = gate.optString("id", "").trim();
      String deviceId = gate.optString("deviceId", "").trim();
      if (id.isEmpty() || deviceId.isEmpty()) continue;
      out.add(new GateEntry(id, GeofenceRegistrar.displayLabel(gate)));
    }
    return out;
  }

  private Action autoOpenAction(boolean armed) {
    int iconRes = armed ? R.drawable.ic_car_auto_open_on : R.drawable.ic_car_auto_open_off;
    CarIcon icon =
      new CarIcon.Builder(IconCompat.createWithResource(getCarContext(), iconRes))
        .setTint(HUD_TEAL)
        .build();
    return new Action.Builder()
      .setTitle(armed ? "On" : "Off")
      .setIcon(icon)
      .setOnClickListener(this::onToggleAutoOpen)
      .build();
  }

  private Action layoutAction(boolean listLayout) {
    // Icon-only: DHU allows only 1 ActionStrip action with a custom title.
    // Bitmaps, not XML vectors — AA rasterized evenOdd/thin paths as X / clock.
    // No setTint: paint HUD teal into the pixels so the host cannot remint them.
    Bitmap bmp = listLayout ? layoutGridBitmap() : layoutListBitmap();
    CarIcon icon = new CarIcon.Builder(IconCompat.createWithBitmap(bmp)).build();
    return new Action.Builder()
      .setIcon(icon)
      .setOnClickListener(this::onToggleLayout)
      .build();
  }

  private static final int GLYPH = 192;
  private static final int GLYPH_TEAL = 0xFF3AA99C;
  private static Bitmap gridGlyph;
  private static Bitmap listGlyph;

  @NonNull
  private static synchronized Bitmap layoutGridBitmap() {
    if (gridGlyph == null || gridGlyph.isRecycled()) {
      gridGlyph = drawGridGlyph();
    }
    return gridGlyph;
  }

  @NonNull
  private static synchronized Bitmap layoutListBitmap() {
    if (listGlyph == null || listGlyph.isRecycled()) {
      listGlyph = drawListGlyph();
    }
    return listGlyph;
  }

  /** Four filled rounded tiles, 2×2, with a wide plus-shaped gap. Not an X. */
  @NonNull
  private static Bitmap drawGridGlyph() {
    Bitmap bmp = Bitmap.createBitmap(GLYPH, GLYPH, Bitmap.Config.ARGB_8888);
    Canvas canvas = new Canvas(bmp);
    Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    paint.setColor(GLYPH_TEAL);
    paint.setStyle(Paint.Style.FILL);
    float pad = 18f;
    float gap = 28f;
    float tile = (GLYPH - 2f * pad - gap) / 2f;
    float radius = 14f;
    for (int row = 0; row < 2; row++) {
      for (int col = 0; col < 2; col++) {
        float left = pad + col * (tile + gap);
        float top = pad + row * (tile + gap);
        canvas.drawRoundRect(
          new RectF(left, top, left + tile, top + tile),
          radius,
          radius,
          paint
        );
      }
    }
    return bmp;
  }

  /** Three thick full-width bars. Not a clock, history arrow, or pin. */
  @NonNull
  private static Bitmap drawListGlyph() {
    Bitmap bmp = Bitmap.createBitmap(GLYPH, GLYPH, Bitmap.Config.ARGB_8888);
    Canvas canvas = new Canvas(bmp);
    Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    paint.setColor(GLYPH_TEAL);
    paint.setStyle(Paint.Style.FILL);
    float padX = 16f;
    float padY = 22f;
    float gap = 22f;
    float barH = (GLYPH - 2f * padY - 2f * gap) / 3f;
    float radius = barH * 0.28f;
    for (int i = 0; i < 3; i++) {
      float top = padY + i * (barH + gap);
      canvas.drawRoundRect(
        new RectF(padX, top, GLYPH - padX, top + barH),
        radius,
        radius,
        paint
      );
    }
    return bmp;
  }

  @NonNull
  private CarIcon tintedIcon(int resId) {
    return new CarIcon.Builder(IconCompat.createWithResource(getCarContext(), resId))
      .setTint(HUD_TEAL)
      .build();
  }

  private int successOrIdleRes(Tile tile) {
    return tile == Tile.OPENED ? R.drawable.ic_car_gate_open : R.drawable.ic_car_gate;
  }

  private GridItem gateItem(GateEntry gate, int imageType) {
    Tile tile = tileOf(gate.id);
    String title = truncateName(gate.name, NAME_MAX_GRID);
    if (tile == Tile.OPENING) {
      return new GridItem.Builder().setTitle(title).setLoading(true).build();
    }
    GridItem.Builder item =
      new GridItem.Builder()
        .setTitle(title)
        .setImage(tintedIcon(successOrIdleRes(tile)), imageType);
    if (tile == Tile.IDLE) {
      item.setOnClickListener(() -> onOpenGate(gate.id));
    }
    return item.build();
  }

  private Row gateRow(GateEntry gate) {
    Tile tile = tileOf(gate.id);
    String title = truncateName(gate.name, NAME_MAX_LIST);
    if (tile == Tile.OPENING) {
      return new Row.Builder().setTitle(title).addText("Opening...").build();
    }
    Row.Builder row =
      new Row.Builder()
        .setTitle(title)
        .addText(tile == Tile.OPENED ? "Opened" : "Tap to open")
        .setImage(tintedIcon(successOrIdleRes(tile)), Row.IMAGE_TYPE_ICON);
    if (tile == Tile.IDLE) {
      row.setOnClickListener(() -> onOpenGate(gate.id));
    }
    return row.build();
  }

  private Tile tileOf(String gateId) {
    synchronized (tiles) {
      Tile found = tiles.get(gateId);
      return found == null ? Tile.IDLE : found;
    }
  }

  private void onToggleAutoOpen() {
    CarContext ctx = getCarContext();
    boolean next = !KeepAlivePrefs.isArmed(ctx);
    KeepAliveModule.applyArmed(ctx, next, next);
    CarToast.makeText(
        ctx,
        next ? "Auto-open on" : "Auto-open off",
        CarToast.LENGTH_SHORT
      )
      .show();
    invalidate();
  }

  private void onToggleLayout() {
    CarContext ctx = getCarContext();
    boolean nextList = !KeepAlivePrefs.isCarListLayout(ctx);
    KeepAlivePrefs.setCarListLayout(ctx, nextList);
    CarToast.makeText(ctx, nextList ? "List" : "Grid", CarToast.LENGTH_SHORT).show();
    invalidate();
  }

  private void onOpenGate(String gateId) {
    synchronized (tiles) {
      Tile cur = tiles.get(gateId);
      if (cur != null && cur != Tile.IDLE) return;
      tiles.put(gateId, Tile.OPENING);
    }
    invalidate();
    OPEN_EXEC.execute(
      () -> {
        String error = PalGateNativeOpen.openManual(getCarContext(), gateId);
        handler.post(() -> onOpenFinished(gateId, error));
      }
    );
  }

  private void onOpenFinished(String gateId, @Nullable String error) {
    if (!active) return;
    if (error == null) {
      synchronized (tiles) {
        tiles.put(gateId, Tile.OPENED);
      }
      invalidate();
      handler.postDelayed(
        () -> {
          if (!active) return;
          synchronized (tiles) {
            tiles.remove(gateId);
          }
          invalidate();
        },
        RESTORE_MS
      );
    } else {
      synchronized (tiles) {
        tiles.remove(gateId);
      }
      invalidate();
      CarToast.makeText(getCarContext(), shortError(error), CarToast.LENGTH_LONG).show();
    }
  }

  @NonNull
  private static String shortError(@Nullable String error) {
    if (error == null) return "Open failed";
    String t = error.trim();
    if (t.isEmpty()) return "Open failed";
    int nl = t.indexOf('\n');
    if (nl > 0) t = t.substring(0, nl).trim();
    if (t.length() > 80) t = t.substring(0, 79).trim() + "...";
    return t;
  }
}
