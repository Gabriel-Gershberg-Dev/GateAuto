package com.gateauto.app.keepalive;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

import com.google.android.gms.location.ActivityRecognition;
import com.google.android.gms.location.ActivityRecognitionResult;
import com.google.android.gms.location.DetectedActivity;

/**
 * Low-rate "on foot" vs "in a vehicle" hint. Off by default. Unknown results
 * leave the Walking switch in charge.
 */
public final class WalkActivity {
  private static final String TAG = "GateAutoKeepAlive";
  static final String ACTION = "com.gateauto.app.WALK_ACTIVITY";
  private static final long INTERVAL_MS = 20_000L;
  private static final int CONFIDENT = 55;

  private WalkActivity() {}

  public static void sync(Context context) {
    if (context == null) return;
    Context app = context.getApplicationContext();
    if (!KeepAlivePrefs.isArmed(app) || !KeepAlivePrefs.motionEnabled(app)) {
      stop(app);
      return;
    }
    if (!granted(app)) {
      Log.i(TAG, "walk activity skip — motion permission not granted");
      KeepAlivePrefs.setWalkActivity(app, "unknown");
      return;
    }
    try {
      ActivityRecognition.getClient(app)
        .requestActivityUpdates(INTERVAL_MS, pending(app))
        .addOnSuccessListener(unused -> Log.i(TAG, "walk activity updates on"))
        .addOnFailureListener(e -> Log.w(TAG, "walk activity request failed", e));
    } catch (SecurityException e) {
      Log.w(TAG, "walk activity denied", e);
    } catch (Exception e) {
      Log.w(TAG, "walk activity error", e);
    }
  }

  public static void stop(Context context) {
    if (context == null) return;
    Context app = context.getApplicationContext();
    try {
      ActivityRecognition.getClient(app)
        .removeActivityUpdates(pending(app))
        .addOnFailureListener(e -> Log.w(TAG, "walk activity remove failed", e));
    } catch (Exception e) {
      Log.w(TAG, "walk activity stop failed", e);
    }
    KeepAlivePrefs.setWalkActivity(app, "unknown");
  }

  static void store(Context context, ActivityRecognitionResult result) {
    if (context == null || result == null) return;
    DetectedActivity top = result.getMostProbableActivity();
    String kind = "unknown";
    int confidence = 0;
    if (top != null) {
      confidence = top.getConfidence();
      if (confidence >= CONFIDENT) kind = kindOf(top.getType());
    }
    KeepAlivePrefs.setWalkActivity(context, kind);
    Log.i(TAG, "walk activity " + kind + " conf=" + confidence);
  }

  private static String kindOf(int type) {
    if (
      type == DetectedActivity.ON_FOOT
        || type == DetectedActivity.WALKING
        || type == DetectedActivity.RUNNING
    ) {
      return "on_foot";
    }
    if (type == DetectedActivity.IN_VEHICLE) return "in_vehicle";
    return "unknown";
  }

  private static boolean granted(Context app) {
    if (Build.VERSION.SDK_INT < 29) return true;
    return app.checkSelfPermission(android.Manifest.permission.ACTIVITY_RECOGNITION)
      == android.content.pm.PackageManager.PERMISSION_GRANTED;
  }

  private static PendingIntent pending(Context app) {
    Intent intent = new Intent(app, WalkActivityReceiver.class).setAction(ACTION);
    int flags = PendingIntent.FLAG_UPDATE_CURRENT;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      flags |= PendingIntent.FLAG_IMMUTABLE;
    }
    return PendingIntent.getBroadcast(app, 0, intent, flags);
  }
}
