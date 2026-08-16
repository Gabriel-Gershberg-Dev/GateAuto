/**
 * Expo config plugin: after BOOT_COMPLETED (and package replace), run a short
 * headless JS task that re-registers geofences when monitoring was left ON.
 *
 * Requires: npx expo prebuild --platform android (or rebuild native app).
 */
const {
  AndroidConfig,
  createRunOncePlugin,
  withAndroidManifest,
  withDangerousMod,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PACKAGE_PATH = 'com/gateauto/app/boot';
const RECEIVER_CLASS = 'BootReceiver';
const SERVICE_CLASS = 'BootSyncService';
const TASK_NAME = 'GateAutoBootSync';

const RECEIVER_JAVA = `package com.gateauto.app.boot;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

import com.facebook.react.HeadlessJsTaskService;
import com.gateauto.app.keepalive.KeepAlivePrefs;
import com.gateauto.app.keepalive.KeepAliveScheduler;

/**
 * Re-sync geofences after reboot / update. Play Services clears geofence
 * registrations across reboot; Force Stop still blocks delivery until next open.
 */
public class BootReceiver extends BroadcastReceiver {
  private static final String TAG = "GateAutoBoot";

  @Override
  public void onReceive(Context context, Intent intent) {
    if (context == null || intent == null) return;
    String action = intent.getAction();
    if (action == null) return;

    boolean relevant =
      Intent.ACTION_BOOT_COMPLETED.equals(action)
        || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
        || "android.intent.action.QUICKBOOT_POWERON".equals(action)
        || "com.htc.intent.action.QUICKBOOT_POWERON".equals(action);
    if (!relevant) return;

    Log.i(TAG, "Scheduling geofence boot sync for action=" + action);
    if (KeepAlivePrefs.isArmed(context)) {
      KeepAliveScheduler.start(context);
    }
    Intent service = new Intent(context, BootSyncService.class);
    HeadlessJsTaskService.acquireWakeLockNow(context);
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(service);
      } else {
        context.startService(service);
      }
    } catch (Exception e) {
      Log.w(TAG, "Failed to start BootSyncService", e);
    }
  }
}
`;

const SERVICE_JAVA = `package com.gateauto.app.boot;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import com.facebook.react.HeadlessJsTaskService;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.jstasks.HeadlessJsTaskConfig;
import com.gateauto.app.R;

/**
 * Brief FGS + headless JS so Android O+ allows boot work. Stops when the
 * JS task finishes — not a continuous location service.
 */
public class BootSyncService extends HeadlessJsTaskService {
  private static final String CHANNEL_ID = "gateauto-boot";
  private static final int NOTIF_ID = 41001;
  private static final String TASK_NAME = "${TASK_NAME}";

  @Override
  public void onCreate() {
    super.onCreate();
    ensureChannel();
    Notification notification =
      new NotificationCompat.Builder(this, CHANNEL_ID)
        .setContentTitle("GateAuto")
        .setContentText("Restoring geofence monitoring…")
        .setSmallIcon(R.mipmap.ic_launcher)
        .setPriority(NotificationCompat.PRIORITY_LOW)
        .setCategory(NotificationCompat.CATEGORY_SERVICE)
        .setOngoing(false)
        .build();
    startForeground(NOTIF_ID, notification);
  }

  private void ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    NotificationManager manager = getSystemService(NotificationManager.class);
    if (manager == null) return;
    NotificationChannel channel =
      new NotificationChannel(
        CHANNEL_ID,
        "GateAuto boot sync",
        NotificationManager.IMPORTANCE_LOW
      );
    channel.setDescription("Brief notice while restoring geofences after reboot");
    manager.createNotificationChannel(channel);
  }

  @Override
  protected @Nullable HeadlessJsTaskConfig getTaskConfig(Intent intent) {
    Bundle extras = intent != null ? intent.getExtras() : null;
    return new HeadlessJsTaskConfig(
      TASK_NAME,
      extras != null ? Arguments.fromBundle(extras) : Arguments.createMap(),
      60000,
      true
    );
  }
}
`;

function writeJavaSources(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const javaRoot = path.join(
        cfg.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'java',
        ...PACKAGE_PATH.split('/'),
      );
      fs.mkdirSync(javaRoot, { recursive: true });
      fs.writeFileSync(path.join(javaRoot, `${RECEIVER_CLASS}.java`), RECEIVER_JAVA);
      fs.writeFileSync(path.join(javaRoot, `${SERVICE_CLASS}.java`), SERVICE_JAVA);
      return cfg;
    },
  ]);
}

function withBootManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    // getMainApplicationOrThrow expects the full modResults ({ manifest: ... }).
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);

    const receivers = app.receiver ?? [];
    const hasReceiver = receivers.some(
      (r) => r?.$?.['android:name'] === `com.gateauto.app.boot.${RECEIVER_CLASS}`,
    );
    if (!hasReceiver) {
      receivers.push({
        $: {
          'android:name': `com.gateauto.app.boot.${RECEIVER_CLASS}`,
          'android:enabled': 'true',
          'android:exported': 'true',
        },
        'intent-filter': [
          {
            action: [
              { $: { 'android:name': 'android.intent.action.BOOT_COMPLETED' } },
              { $: { 'android:name': 'android.intent.action.QUICKBOOT_POWERON' } },
              { $: { 'android:name': 'android.intent.action.MY_PACKAGE_REPLACED' } },
            ],
          },
        ],
      });
      app.receiver = receivers;
    }

    const services = app.service ?? [];
    const hasService = services.some(
      (s) => s?.$?.['android:name'] === `com.gateauto.app.boot.${SERVICE_CLASS}`,
    );
    if (!hasService) {
      services.push({
        $: {
          'android:name': `com.gateauto.app.boot.${SERVICE_CLASS}`,
          'android:exported': 'false',
          'android:foregroundServiceType': 'shortService',
        },
      });
      app.service = services;
    }

    return cfg;
  });
}

function withAndroidBootSync(config) {
  config = AndroidConfig.Permissions.withPermissions(config, [
    'android.permission.RECEIVE_BOOT_COMPLETED',
    'android.permission.WAKE_LOCK',
    'android.permission.FOREGROUND_SERVICE',
    'android.permission.FOREGROUND_SERVICE_SHORT_SERVICE',
  ]);
  config = writeJavaSources(config);
  config = withBootManifest(config);
  return config;
}

module.exports = createRunOncePlugin(
  withAndroidBootSync,
  'gateauto-android-boot-sync',
  '1.0.1',
);
