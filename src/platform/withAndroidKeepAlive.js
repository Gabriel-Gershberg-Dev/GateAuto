/**
 * Expo config plugin: native geofences + sticky location FGS + BT ACL
 * so Auto-open survives a long lock on Samsung (no JobScheduler).
 */
const {
  AndroidConfig,
  createRunOncePlugin,
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
  withMainApplication,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PACKAGE_PATH = 'com/gateauto/app/keepalive';
const SRC_DIR = path.join(__dirname, 'android-keepalive');
const JAVA_FILES = [
  'KeepAlivePrefs.java',
  'KeepAliveScheduler.java',
  'KeepAliveReceiver.java',
  'KeepAliveService.java',
  'KeepAliveModule.java',
  'KeepAlivePackage.java',
  'GeofenceRegistrar.java',
  'GeofenceTransitionReceiver.java',
  'MonitoringService.java',
  'BtConnectReceiver.java',
  'PalGateAes.java',
  'PalGateToken.java',
  'PalGateNativeOpen.java',
];

function withKeepAliveSources(config) {
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
      for (const file of JAVA_FILES) {
        fs.copyFileSync(path.join(SRC_DIR, file), path.join(javaRoot, file));
      }
      return cfg;
    },
  ]);
}

function upsertReceiver(app, name, attrs, intentFilter) {
  const receivers = app.receiver ?? [];
  if (receivers.some((r) => r?.$?.['android:name'] === name)) {
    app.receiver = receivers;
    return;
  }
  receivers.push({ $: { 'android:name': name, ...attrs }, 'intent-filter': intentFilter });
  app.receiver = receivers;
}

function upsertService(app, name, attrs) {
  const services = app.service ?? [];
  if (services.some((s) => s?.$?.['android:name'] === name)) {
    app.service = services;
    return;
  }
  services.push({ $: { 'android:name': name, ...attrs } });
  app.service = services;
}

function withKeepAliveManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);

    upsertReceiver(
      app,
      'com.gateauto.app.keepalive.KeepAliveReceiver',
      { 'android:enabled': 'true', 'android:exported': 'false' },
      [
        {
          action: [
            { $: { 'android:name': 'com.gateauto.app.KEEPALIVE_ALARM' } },
            { $: { 'android:name': 'com.gateauto.app.COOLDOWN_WAKE' } },
          ],
        },
      ],
    );
    const keepAliveReceiver = (app.receiver ?? []).find(
      (r) => r?.$?.['android:name'] === 'com.gateauto.app.keepalive.KeepAliveReceiver',
    );
    const keepAliveActions = keepAliveReceiver?.['intent-filter']?.[0]?.action ?? [];
    if (
      keepAliveReceiver &&
      !keepAliveActions.some(
        (a) => a?.$?.['android:name'] === 'com.gateauto.app.COOLDOWN_WAKE',
      )
    ) {
      keepAliveActions.push({
        $: { 'android:name': 'com.gateauto.app.COOLDOWN_WAKE' },
      });
      keepAliveReceiver['intent-filter'][0].action = keepAliveActions;
    }
    upsertReceiver(
      app,
      'com.gateauto.app.keepalive.GeofenceTransitionReceiver',
      { 'android:enabled': 'true', 'android:exported': 'false' },
      [{ action: [{ $: { 'android:name': 'com.gateauto.app.GEOFENCE_TRANSITION' } }] }],
    );
    upsertReceiver(
      app,
      'com.gateauto.app.keepalive.BtConnectReceiver',
      { 'android:enabled': 'true', 'android:exported': 'true' },
      [
        {
          action: [
            { $: { 'android:name': 'android.bluetooth.device.action.ACL_CONNECTED' } },
            { $: { 'android:name': 'android.bluetooth.a2dp.profile.action.CONNECTION_STATE_CHANGED' } },
            { $: { 'android:name': 'android.bluetooth.headset.profile.action.CONNECTION_STATE_CHANGED' } },
          ],
        },
      ],
    );

    upsertService(app, 'com.gateauto.app.keepalive.KeepAliveService', {
      'android:exported': 'false',
      'android:foregroundServiceType': 'location',
    });
    const keepAliveService = (app.service ?? []).find(
      (s) => s?.$?.['android:name'] === 'com.gateauto.app.keepalive.KeepAliveService',
    );
    if (keepAliveService?.$) {
      keepAliveService.$['android:foregroundServiceType'] = 'location';
    }
    upsertService(app, 'com.gateauto.app.keepalive.MonitoringService', {
      'android:exported': 'false',
      'android:foregroundServiceType': 'location',
      'android:stopWithTask': 'false',
    });

    const locationService = (app.service ?? []).find(
      (s) =>
        s?.$?.['android:name'] ===
        'expo.modules.location.services.LocationTaskService',
    );
    if (locationService?.$) {
      locationService.$['android:stopWithTask'] = 'false';
    }

    return cfg;
  });
}

function withKeepAlivePackage(config) {
  return withMainApplication(config, (cfg) => {
    let contents = cfg.modResults.contents;
    const importLine = 'import com.gateauto.app.keepalive.KeepAlivePackage;';
    if (!contents.includes(importLine)) {
      if (/^package\s+[\w.]+;?\s*$/m.test(contents)) {
        contents = contents.replace(
          /^(package\s+[\w.]+;?\s*)$/m,
          `$1\n\n${importLine}`,
        );
      } else {
        contents = `${importLine}\n${contents}`;
      }
    }
    if (!contents.includes('add(KeepAlivePackage())')) {
      if (contents.includes('add(GateAutoCarBluetoothPackage())')) {
        contents = contents.replace(
          'add(GateAutoCarBluetoothPackage())',
          'add(GateAutoCarBluetoothPackage())\n              add(KeepAlivePackage())',
        );
      }
    }
    if (
      contents.includes('KeepAliveScheduler.start(this)') &&
      !contents.includes('GeofenceRegistrar.register(this, false)')
    ) {
      contents = contents.replace(
        'KeepAliveScheduler.start(this)',
        'KeepAliveScheduler.start(this)\n      GeofenceRegistrar.register(this, false)',
      );
    }
    cfg.modResults.contents = contents;
    return cfg;
  });
}

function withPlayServicesLocation(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes('play-services-location')) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /dependencies\s*\{/,
        `dependencies {\n    implementation("com.google.android.gms:play-services-location:21.3.0")`,
      );
    }
    return cfg;
  });
}

function withAndroidKeepAlive(config) {
  config = AndroidConfig.Permissions.withPermissions(config, [
    'android.permission.SCHEDULE_EXACT_ALARM',
    'android.permission.FOREGROUND_SERVICE_SHORT_SERVICE',
    'android.permission.FOREGROUND_SERVICE_LOCATION',
    'android.permission.WAKE_LOCK',
    'android.permission.RECEIVE_BOOT_COMPLETED',
  ]);
  config = withKeepAliveSources(config);
  config = withKeepAliveManifest(config);
  config = withKeepAlivePackage(config);
  config = withPlayServicesLocation(config);
  return config;
}

module.exports = createRunOncePlugin(
  withAndroidKeepAlive,
  'gateauto-android-keep-alive',
  '1.7.0',
);
