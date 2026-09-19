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
  'AutoOpenPermissionStatus.java',
  'GeofenceRegistrar.java',
  'GeofenceTransitionReceiver.java',
  'MonitoringService.java',
  'ApproachSampler.java',
  'MonitoringNotice.java',
  'MonitoringNoticeReceiver.java',
  'HoldService.java',
  'BtConnectReceiver.java',
  'CarBluetoothState.java',
  'PalGateAes.java',
  'PalGateToken.java',
  'PalGateNativeOpen.java',
  'GateAutoTelemetry.java',
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

function upsertService(app, name, attrs, children) {
  const services = app.service ?? [];
  if (services.some((s) => s?.$?.['android:name'] === name)) {
    app.service = services;
    return;
  }
  const service = { $: { 'android:name': name, ...attrs } };
  if (children) Object.assign(service, children);
  services.push(service);
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
            { $: { 'android:name': 'com.gateauto.app.HOLD_PULSE' } },
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
        (a) => a?.$?.['android:name'] === 'com.gateauto.app.HOLD_PULSE',
      )
    ) {
      keepAliveActions.push({
        $: { 'android:name': 'com.gateauto.app.HOLD_PULSE' },
      });
      keepAliveReceiver['intent-filter'][0].action = keepAliveActions;
    }
    // Delete intent of the monitoring notice: Android 13+ lets the user swipe an
    // ongoing FGS notification away, so re-post it while still armed.
    upsertReceiver(
      app,
      'com.gateauto.app.keepalive.MonitoringNoticeReceiver',
      { 'android:enabled': 'true', 'android:exported': 'false' },
      [
        {
          action: [
            { $: { 'android:name': 'com.gateauto.app.MONITOR_NOTICE_RESTORE' } },
          ],
        },
      ],
    );
    upsertReceiver(
      app,
      'com.gateauto.app.keepalive.GeofenceTransitionReceiver',
      { 'android:enabled': 'true', 'android:exported': 'false' },
      [{ action: [{ $: { 'android:name': 'com.gateauto.app.GEOFENCE_TRANSITION' } }] }],
    );
    // ACL_DISCONNECTED matters as much as ACL_CONNECTED: these manifest
    // broadcasts are what keep the cached connected-car set exact even while the
    // process is dead, so a locked-phone open can answer "is the car connected?"
    // without an async Bluetooth read. See CarBluetoothState.
    upsertReceiver(
      app,
      'com.gateauto.app.keepalive.BtConnectReceiver',
      { 'android:enabled': 'true', 'android:exported': 'true' },
      [
        {
          action: [
            { $: { 'android:name': 'android.bluetooth.device.action.ACL_CONNECTED' } },
            { $: { 'android:name': 'android.bluetooth.device.action.ACL_DISCONNECTED' } },
            { $: { 'android:name': 'android.bluetooth.a2dp.profile.action.CONNECTION_STATE_CHANGED' } },
            { $: { 'android:name': 'android.bluetooth.headset.profile.action.CONNECTION_STATE_CHANGED' } },
          ],
        },
      ],
    );
    const btReceiver = (app.receiver ?? []).find(
      (r) => r?.$?.['android:name'] === 'com.gateauto.app.keepalive.BtConnectReceiver',
    );
    const btActions = btReceiver?.['intent-filter']?.[0]?.action ?? [];
    if (
      btReceiver &&
      !btActions.some(
        (a) =>
          a?.$?.['android:name'] ===
          'android.bluetooth.device.action.ACL_DISCONNECTED',
      )
    ) {
      btActions.push({
        $: { 'android:name': 'android.bluetooth.device.action.ACL_DISCONNECTED' },
      });
      btReceiver['intent-filter'][0].action = btActions;
    }

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

    // Non-location process-hold FGS. specialUse (not location) so it can be
    // started from a background broadcast without Samsung stripping GPS.
    upsertService(
      app,
      'com.gateauto.app.keepalive.HoldService',
      {
        'android:exported': 'false',
        'android:foregroundServiceType': 'specialUse',
        'android:stopWithTask': 'false',
      },
      {
        property: [
          {
            $: {
              'android:name':
                'android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE',
              'android:value':
                'Keeps the auto-open process warm so a configured gate opens instantly on arrival without a cold restart.',
            },
          },
        ],
      },
    );

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
      } else if (contents.includes('add(StreetViewPackage())')) {
        contents = contents.replace(
          'add(StreetViewPackage())',
          'add(KeepAlivePackage())\n              add(StreetViewPackage())',
        );
      } else if (contents.includes('PackageList(this).packages.apply')) {
        contents = contents.replace(
          /PackageList\(this\)\.packages\.apply\s*\{/,
          (match) => `${match}\n              add(KeepAlivePackage())`,
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
    // Hold the process with a non-location FGS on every (possibly cold-started)
    // process start when armed, so it cannot drop to cached/empty between
    // arrivals. HoldService.ensure self-guards on armed and requests no GPS.
    const holdEnsure = 'com.gateauto.app.keepalive.HoldService.ensure(this)';
    if (
      !contents.includes(holdEnsure) &&
      contents.includes('ApplicationLifecycleDispatcher.onApplicationCreate(this)')
    ) {
      contents = contents.replace(
        'ApplicationLifecycleDispatcher.onApplicationCreate(this)',
        `ApplicationLifecycleDispatcher.onApplicationCreate(this)\n    ${holdEnsure}`,
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
    if (!cfg.modResults.contents.includes('firebase-analytics')) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /dependencies\s*\{/,
        `dependencies {\n    implementation(platform("com.google.firebase:firebase-bom:34.18.0"))\n    implementation("com.google.firebase:firebase-crashlytics")\n    implementation("com.google.firebase:firebase-analytics")`,
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
    'android.permission.FOREGROUND_SERVICE_SPECIAL_USE',
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
  '1.17.0',
);
