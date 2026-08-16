package com.gateauto.app.streetview;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.facebook.react.common.MapBuilder;
import com.facebook.react.uimanager.SimpleViewManager;
import com.facebook.react.uimanager.ThemedReactContext;
import com.facebook.react.uimanager.annotations.ReactProp;

import java.util.Map;

public class GateAutoStreetViewManager extends SimpleViewManager<GateAutoStreetView> {
  public static final String REACT_CLASS = "GateAutoStreetView";

  @NonNull
  @Override
  public String getName() {
    return REACT_CLASS;
  }

  @NonNull
  @Override
  protected GateAutoStreetView createViewInstance(@NonNull ThemedReactContext reactContext) {
    return new GateAutoStreetView(reactContext);
  }

  @ReactProp(name = "latitude")
  public void setLatitude(GateAutoStreetView view, double latitude) {
    view.setLatitude(latitude);
  }

  @ReactProp(name = "longitude")
  public void setLongitude(GateAutoStreetView view, double longitude) {
    view.setLongitude(longitude);
  }

  @Override
  public void onDropViewInstance(@NonNull GateAutoStreetView view) {
    view.destroyPanorama();
    super.onDropViewInstance(view);
  }

  @Nullable
  @Override
  public Map<String, Object> getExportedCustomDirectEventTypeConstants() {
    return MapBuilder.of(
      GateAutoStreetView.EVENT_COVERAGE,
      MapBuilder.of("registrationName", GateAutoStreetView.EVENT_COVERAGE)
    );
  }
}
