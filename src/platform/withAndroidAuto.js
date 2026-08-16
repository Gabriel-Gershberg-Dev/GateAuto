/**
 * Expo config plugin: Android Auto Car App Library UI (CATEGORY_IOT).
 * Copies native sources into android/ on prebuild. minCarApiLevel 6.
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
  ['res/drawable/ic_car_auto_open_on.xml', 'drawable/ic_car_auto_open_on.xml'],
  ['res/drawable/ic_car_auto_open_off.xml', 'drawable/ic_car_auto_open_off.xml'],
];
const CAR_APP_DEP = 'androidx.car.app:app:1.4.0';

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
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);

    upsertMeta(app, 'com.google.android.gms.car.application', {
      'android:resource': '@xml/automotive_app_desc',
    });
    upsertMeta(app, 'androidx.car.app.minCarApiLevel', {
      'android:value': '6',
    });

    upsertService(
      app,
      'com.gateauto.app.car.GateAutoCarAppService',
      {
        'android:exported': 'true',
        'android:label': '@string/app_name',
        'android:icon': '@mipmap/ic_launcher',
      },
      [
        {
          action: [{ $: { 'android:name': 'androidx.car.app.CarAppService' } }],
          category: [{ $: { 'android:name': 'androidx.car.app.category.IOT' } }],
        },
      ],
    );

    return cfg;
  });
}

function withCarAppDependency(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes(CAR_APP_DEP)) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /dependencies\s*\{/,
        `dependencies {\n    implementation("${CAR_APP_DEP}")`,
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

module.exports = createRunOncePlugin(withAndroidAuto, 'gateauto-android-auto', '1.0.0');
