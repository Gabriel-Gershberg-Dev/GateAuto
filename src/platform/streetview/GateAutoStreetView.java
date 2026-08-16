package com.gateauto.app.streetview;

import android.widget.FrameLayout;

import androidx.annotation.Nullable;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.ReactContext;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.uimanager.ThemedReactContext;
import com.facebook.react.uimanager.events.RCTEventEmitter;
import com.google.android.gms.maps.StreetViewPanoramaView;
import com.google.android.gms.maps.model.LatLng;
import com.google.android.gms.maps.model.StreetViewSource;

/**
 * In-app Street View using the same Android Maps SDK key as the map.
 */
public class GateAutoStreetView extends FrameLayout {
  public static final String EVENT_COVERAGE = "onCoverageChange";
  private static final int SEARCH_RADIUS_M = 120;

  private final StreetViewPanoramaView panoramaView;
  private boolean created;
  private boolean destroyed;
  private Double pendingLat;
  private Double pendingLng;
  private Double propLat;
  private Double propLng;

  public GateAutoStreetView(ThemedReactContext context) {
    super(context);
    panoramaView = new StreetViewPanoramaView(context);
    addView(
      panoramaView,
      new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
    );
    panoramaView.onCreate(null);
    panoramaView.onResume();
    created = true;
  }

  public void setLatitude(double lat) {
    propLat = lat;
    applyProps();
  }

  public void setLongitude(double lng) {
    propLng = lng;
    applyProps();
  }

  private void applyProps() {
    if (propLat == null || propLng == null) return;
    setCoordinate(propLat, propLng);
  }

  public void setCoordinate(double lat, double lng) {
    pendingLat = lat;
    pendingLng = lng;
    if (!created || destroyed) return;
    panoramaView.getStreetViewPanoramaAsync(panorama -> {
      if (destroyed) return;
      panorama.setStreetNamesEnabled(true);
      panorama.setUserNavigationEnabled(true);
      panorama.setZoomGesturesEnabled(true);
      panorama.setPanningGesturesEnabled(true);
      panorama.setOnStreetViewPanoramaChangeListener(location -> {
        WritableMap event = Arguments.createMap();
        event.putBoolean("available", location != null);
        if (location != null && location.position != null) {
          event.putDouble("latitude", location.position.latitude);
          event.putDouble("longitude", location.position.longitude);
        }
        emit(event);
      });
      panorama.setPosition(
        new LatLng(lat, lng),
        SEARCH_RADIUS_M,
        StreetViewSource.OUTDOOR
      );
    });
  }

  void onHostResume() {
    if (created && !destroyed) {
      panoramaView.onResume();
    }
  }

  void onHostPause() {
    if (created && !destroyed) {
      panoramaView.onPause();
    }
  }

  void destroyPanorama() {
    if (destroyed) return;
    destroyed = true;
    try {
      panoramaView.onPause();
      panoramaView.onDestroy();
    } catch (RuntimeException ignored) {
      // View may already be torn down with the activity.
    }
  }

  @Override
  protected void onAttachedToWindow() {
    super.onAttachedToWindow();
    if (created && !destroyed) {
      panoramaView.onResume();
      if (pendingLat != null && pendingLng != null) {
        setCoordinate(pendingLat, pendingLng);
      }
    }
  }

  @Override
  protected void onDetachedFromWindow() {
    if (created && !destroyed) {
      panoramaView.onPause();
    }
    super.onDetachedFromWindow();
  }

  private void emit(@Nullable WritableMap event) {
    ReactContext reactContext = (ReactContext) getContext();
    reactContext
      .getJSModule(RCTEventEmitter.class)
      .receiveEvent(getId(), EVENT_COVERAGE, event);
  }
}
