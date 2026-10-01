package com.gateauto.app.keepalive;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import com.google.android.gms.location.ActivityRecognitionResult;

/** Play Services activity updates. Does not open a gate by itself. */
public class WalkActivityReceiver extends BroadcastReceiver {
  @Override
  public void onReceive(Context context, Intent intent) {
    if (context == null || intent == null) return;
    if (!ActivityRecognitionResult.hasResult(intent)) return;
    WalkActivity.store(context, ActivityRecognitionResult.extractResult(intent));
  }
}
