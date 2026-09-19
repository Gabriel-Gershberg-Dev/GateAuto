package com.gateauto.app.keepalive;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Delete intent of the monitoring notice. Android 13+ lets the user swipe an
 * ongoing foreground-service notification away without stopping the service;
 * this puts it back while monitoring is still armed. All guards live in
 * {@link MonitoringNotice#onDismissed}.
 */
public class MonitoringNoticeReceiver extends BroadcastReceiver {
  @Override
  public void onReceive(Context context, Intent intent) {
    if (intent == null) return;
    if (!MonitoringNotice.ACTION_RESTORE.equals(intent.getAction())) return;
    MonitoringNotice.onDismissed(
      context,
      intent.getIntExtra(MonitoringNotice.EXTRA_NOTIF_ID, 0)
    );
  }
}
