package com.gateauto.app.car;

import androidx.annotation.NonNull;
import androidx.car.app.CarContext;
import androidx.car.app.CarToast;
import androidx.car.app.Screen;
import androidx.car.app.model.Action;
import androidx.car.app.model.ActionStrip;
import androidx.car.app.model.CarIcon;
import androidx.car.app.model.GridItem;
import androidx.car.app.model.GridTemplate;
import androidx.car.app.model.ItemList;
import androidx.car.app.model.MessageTemplate;
import androidx.car.app.model.Template;
import androidx.core.graphics.drawable.IconCompat;

import com.gateauto.app.R;
import com.gateauto.app.keepalive.GeofenceRegistrar;
import com.gateauto.app.keepalive.KeepAliveModule;
import com.gateauto.app.keepalive.KeepAlivePrefs;
import com.gateauto.app.keepalive.PalGateNativeOpen;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;

/**
 * Car grid: one icon per gate (tap = manual PalGate open) plus a compact
 * Auto-open header action that arms/disarms native keep-alive.
 */
public class GateAutoCarScreen extends Screen {
  private static final Executor OPEN_EXEC = Executors.newSingleThreadExecutor();
  private final Set<String> openingIds = new HashSet<>();

  public GateAutoCarScreen(@NonNull CarContext carContext) {
    super(carContext);
  }

  @NonNull
  @Override
  public Template onGetTemplate() {
    boolean armed = KeepAlivePrefs.isArmed(getCarContext());
    ActionStrip strip =
      new ActionStrip.Builder().addAction(autoOpenAction(armed)).build();

    ItemList.Builder list = new ItemList.Builder();
    JSONArray gates = GeofenceRegistrar.regionsArray(getCarContext());
    int count = 0;
    if (gates != null) {
      for (int i = 0; i < gates.length(); i++) {
        JSONObject gate = gates.optJSONObject(i);
        if (gate == null) continue;
        String id = gate.optString("id", "").trim();
        String deviceId = gate.optString("deviceId", "").trim();
        if (id.isEmpty() || deviceId.isEmpty()) continue;
        String name = GeofenceRegistrar.displayLabel(gate);
        list.addItem(gateItem(id, name));
        count++;
      }
    }

    String title = armed ? "GateAuto" : "Auto-open off";
    if (count == 0) {
      return new MessageTemplate.Builder(
          "No gates yet. Open GateAuto on your phone, link PalGate, then come back."
        )
        .setTitle(title)
        .setHeaderAction(Action.APP_ICON)
        .setActionStrip(strip)
        .build();
    }

    return new GridTemplate.Builder()
      .setTitle(title)
      .setHeaderAction(Action.APP_ICON)
      .setActionStrip(strip)
      .setSingleList(list.build())
      .build();
  }

  private Action autoOpenAction(boolean armed) {
    int iconRes = armed ? R.drawable.ic_car_auto_open_on : R.drawable.ic_car_auto_open_off;
    CarIcon icon =
      new CarIcon.Builder(IconCompat.createWithResource(getCarContext(), iconRes)).build();
    return new Action.Builder()
      .setTitle(armed ? "Auto-open On" : "Auto-open Off")
      .setIcon(icon)
      .setOnClickListener(this::onToggleAutoOpen)
      .build();
  }

  private GridItem gateItem(String gateId, String name) {
    boolean opening;
    synchronized (openingIds) {
      opening = openingIds.contains(gateId);
    }
    CarIcon icon =
      new CarIcon.Builder(
          IconCompat.createWithResource(getCarContext(), R.drawable.ic_car_gate)
        )
        .build();
    GridItem.Builder builder =
      new GridItem.Builder()
        .setTitle(name)
        .setImage(icon, GridItem.IMAGE_TYPE_ICON);
    if (opening) {
      builder.setLoading(true);
    } else {
      builder.setOnClickListener(() -> onOpenGate(gateId));
    }
    return builder.build();
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

  private void onOpenGate(String gateId) {
    synchronized (openingIds) {
      if (!openingIds.add(gateId)) return;
    }
    invalidate();
    CarToast.makeText(getCarContext(), "Opening…", CarToast.LENGTH_SHORT).show();
    OPEN_EXEC.execute(
      () -> {
        String error = PalGateNativeOpen.openManual(getCarContext(), gateId);
        getCarContext()
          .getMainExecutor()
          .execute(
            () -> {
              synchronized (openingIds) {
                openingIds.remove(gateId);
              }
              if (error == null) {
                CarToast.makeText(
                    getCarContext(),
                    "Opened",
                    CarToast.LENGTH_SHORT
                  )
                  .show();
              } else {
                CarToast.makeText(getCarContext(), error, CarToast.LENGTH_LONG).show();
              }
              invalidate();
            }
          );
      }
    );
  }
}
