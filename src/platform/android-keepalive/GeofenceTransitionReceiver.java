package com.gateauto.app.keepalive;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.google.android.gms.location.Geofence;
import com.google.android.gms.location.GeofencingEvent;

/**
 * Play Services geofence callback. Opens PalGate in this process (no JS / no
 * FGS start) so Android 14 background restrictions cannot block it.
 */
public class GeofenceTransitionReceiver extends BroadcastReceiver {
  private static final String TAG = "GateAutoKeepAlive";

  @Override
  public void onReceive(Context context, Intent intent) {
    if (context == null || !KeepAlivePrefs.isArmed(context)) return;

    GeofencingEvent event = GeofencingEvent.fromIntent(intent);
    if (event == null) {
      Log.w(TAG, "null geofencing event");
      return;
    }
    if (event.hasError()) {
      Log.w(TAG, "geofencing error " + event.getErrorCode());
      return;
    }

    String reason =
      event.getGeofenceTransition() == Geofence.GEOFENCE_TRANSITION_EXIT ? "exit" : "enter";
    if (event.getTriggeringGeofences() == null) return;

    final PendingResult pending = goAsync();
    final Context app = context.getApplicationContext();
    new Thread(
      () -> {
        try {
          for (Geofence geofence : event.getTriggeringGeofences()) {
            String id = geofence.getRequestId();
            if (id == null || id.trim().isEmpty()) continue;
            Log.i(TAG, "native geofence " + reason + " " + id);
            PalGateNativeOpen.openFromGeofence(app, id, reason);
          }
        } finally {
          new Handler(Looper.getMainLooper()).post(pending::finish);
        }
      },
      "gateauto-geo-open"
    ).start();
  }
}
