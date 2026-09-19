/**
 * Expo config plugin: Android Auto Car App Library UI.
 * Copies native sources into android/ on prebuild.
 *
 * IOT is the Play-correct garage/gate category (Car API 6+). Many projected
 * Android Auto hosts still filter IOT out of the launcher even with Unknown
 * sources — also declare POI so a sideloaded APK is listed. Do not drop IOT.
 *
 * Projected Android Auto (phone → DHU / car) binds {@code CarAppService} only.
 * Do not declare {@code CarAppActivity} as MAIN/LAUNCHER on this phone APK:
 * it becomes the first {@code getLaunchIntentForPackage} target, so tapping
 * an Expo update notice (or a second home-screen icon) opens Android Auto's
 * black "Check for updates" / "System requires update" screen. AAOS can add
 * that activity later on an automotive flavor.
 */
const {
  AndroidConfig,
  createRunOncePlugin,
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PACKAGE_PATH = 'com/gateauto/app/car';
const SRC_DIR = path.join(__dirname, 'android-auto');
const JAVA_FILES = [
  'GateAutoCarAppService.java',
  'GateAutoCarSession.java',
  'GateAutoCarScreen.java',
];
const RES_FILES = [
  ['res/xml/automotive_app_desc.xml', 'xml/automotive_app_desc.xml'],
  ['res/drawable/ic_car_gate.xml', 'drawable/ic_car_gate.xml'],
  ['res/drawable/ic_car_gate_open.xml', 'drawable/ic_car_gate_open.xml'],
  ['res/drawable/ic_car_layout_list.xml', 'drawable/ic_car_layout_list.xml'],
  ['res/drawable/ic_car_layout_grid.xml', 'drawable/ic_car_layout_grid.xml'],
  ['res/drawable/ic_car_auto_open_on.xml', 'drawable/ic_car_auto_open_on.xml'],
  ['res/drawable/ic_car_auto_open_off.xml', 'drawable/ic_car_auto_open_off.xml'],
  ['res/values/car_colors.xml', 'values/car_colors.xml'],
  ['res/values/car_theme.xml', 'values/car_theme.xml'],
];
const CAR_APP_DEP = 'androidx.car.app:app:1.4.0';
const CAR_APP_AUTOMOTIVE_DEP = 'androidx.car.app:app-automotive:1.4.0';

function copyAndroidAutoSources(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const root = cfg.modRequest.platformProjectRoot;
      const javaRoot = path.join(root, 'app', 'src', 'main', 'java', ...PACKAGE_PATH.split('/'));
      fs.mkdirSync(javaRoot, { recursive: true });
      for (const file of JAVA_FILES) {
        fs.copyFileSync(path.join(SRC_DIR, file), path.join(javaRoot, file));
      }
      const resRoot = path.join(root, 'app', 'src', 'main', 'res');
      for (const [from, to] of RES_FILES) {
        const dest = path.join(resRoot, to);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(path.join(SRC_DIR, from), dest);
      }
      return cfg;
    },
  ]);
}

function upsertMeta(app, name, attrs) {
  const metas = app['meta-data'] ?? [];
  const existing = metas.find((m) => m?.$?.['android:name'] === name);
  if (existing) {
    Object.assign(existing.$, attrs);
  } else {
    metas.push({ $: { 'android:name': name, ...attrs } });
  }
  app['meta-data'] = metas;
}

function upsertActivity(app, name, attrs, intentFilter, extraMeta) {
  const activities = app.activity ?? [];
  const existing = activities.find((a) => a?.$?.['android:name'] === name);
  if (existing) {
    Object.assign(existing.$, attrs);
    if (intentFilter) existing['intent-filter'] = intentFilter;
    if (extraMeta) existing['meta-data'] = extraMeta;
    app.activity = activities;
    return;
  }
  const node = { $: { 'android:name': name, ...attrs } };
  if (intentFilter) node['intent-filter'] = intentFilter;
  if (extraMeta) node['meta-data'] = extraMeta;
  activities.push(node);
  app.activity = activities;
}

function upsertService(app, name, attrs, intentFilter, extraMeta) {
  const services = app.service ?? [];
  const existing = services.find((s) => s?.$?.['android:name'] === name);
  if (existing) {
    Object.assign(existing.$, attrs);
    if (intentFilter) existing['intent-filter'] = intentFilter;
    if (extraMeta) existing['meta-data'] = extraMeta;
    app.service = services;
    return;
  }
  const node = { $: { 'android:name': name, ...attrs } };
  if (intentFilter) node['intent-filter'] = intentFilter;
  if (extraMeta) node['meta-data'] = extraMeta;
  services.push(node);
  app.service = services;
}

function withAndroidAutoManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    // app-automotive 1.4 requires min 29; do not raise the phone minSdk.
    const sdkNodes = [].concat(manifest['uses-sdk'] || []);
    const first = sdkNodes[0] || { $: {} };
    const prev = String(first.$['tools:overrideLibrary'] || '');
    const libs = prev
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!libs.includes('androidx.car.app.automotive')) {
      libs.push('androidx.car.app.automotive');
    }
    first.$['tools:overrideLibrary'] = libs.join(',');
    manifest['uses-sdk'] = [first, ...sdkNodes.slice(1)];

    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);

    upsertMeta(app, 'com.google.android.gms.car.application', {
      'android:resource': '@xml/automotive_app_desc',
    });
    // AAOS templates host (projected Android Auto keeps the GMS name above).
    upsertMeta(app, 'com.android.automotive', {
      'android:resource': '@xml/automotive_app_desc',
    });
    // 3 so older projected hosts still list via POI. IOT itself needs API 6;
    // requiring 6 hid the app on cars whose host is 3–5.
    upsertMeta(app, 'androidx.car.app.minCarApiLevel', {
      'android:value': '3',
    });
    upsertMeta(app, 'androidx.car.app.theme', {
      'android:resource': '@style/GateAutoCarTheme',
    });

    upsertService(
      app,
      'com.gateauto.app.car.GateAutoCarAppService',
      {
        'android:exported': 'true',
        'android:label': '@string/app_name',
        'android:icon': '@mipmap/ic_launcher',
        // Do not set android:permission=BIND_CAR_APP. That permission is
        // signature-owned by this APK, so the AAOS templates host (platform
        // signed) cannot bind and the car UI shows a generic error.
      },
      [
        {
          action: [{ $: { 'android:name': 'androidx.car.app.CarAppService' } }],
          category: [{ $: { 'android:name': 'androidx.car.app.category.IOT' } }],
        },
        // Sideload listing: real AA often ignores IOT. Keep IOT for Play later.
        {
          action: [{ $: { 'android:name': 'androidx.car.app.CarAppService' } }],
          category: [{ $: { 'android:name': 'androidx.car.app.category.POI' } }],
        },
      ],
    );

    // Strip any leftover phone-launcher CarAppActivity from an older prebuild.
    if (!manifest.$) manifest.$ = {};
    if (!manifest.$['xmlns:tools']) {
      manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }
    const activities = (app.activity ?? []).filter(
      (a) => a?.$?.['android:name'] !== 'androidx.car.app.activity.CarAppActivity',
    );
    activities.push({
      $: {
        'android:name': 'androidx.car.app.activity.CarAppActivity',
        'tools:node': 'remove',
      },
    });
    app.activity = activities;

    return cfg;
  });
}

function withCarAppDependency(config) {
  return withAppBuildGradle(config, (cfg) => {
    const extras = [];
    if (!cfg.modResults.contents.includes(CAR_APP_DEP)) {
      extras.push(`    implementation("${CAR_APP_DEP}")`);
    }
    if (!cfg.modResults.contents.includes(CAR_APP_AUTOMOTIVE_DEP)) {
      extras.push(`    implementation("${CAR_APP_AUTOMOTIVE_DEP}")`);
    }
    if (extras.length) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /dependencies\s*\{/,
        `dependencies {\n${extras.join('\n')}`,
      );
    }
    return cfg;
  });
}

function withAndroidAuto(config) {
  config = copyAndroidAutoSources(config);
  config = withAndroidAutoManifest(config);
  config = withCarAppDependency(config);
  return config;
}

module.exports = createRunOncePlugin(withAndroidAuto, 'gateauto-android-auto', '1.3.6');
