/**
 * Injects the Android Maps SDK key into the manifest and copies the in-app
 * Street View native view. Does not log the key.
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

const PACKAGE_PATH = 'com/gateauto/app/streetview';
const SRC_DIR = path.join(__dirname, 'streetview');
const JAVA_FILES = [
  'GateAutoStreetView.java',
  'GateAutoStreetViewManager.java',
  'StreetViewPackage.java',
];

function mapsApiKey(config) {
  const raw = config.android?.config?.googleMaps?.apiKey;
  return typeof raw === 'string' ? raw.trim() : '';
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

function withMapsKeyManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const key = mapsApiKey(cfg);
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    if (key) {
      upsertMeta(app, 'com.google.android.geo.API_KEY', {
        'android:value': key,
      });
    }

    const manifest = cfg.modResults.manifest;
    const queries = manifest.queries ?? [];
    const hasStreetView = queries.some((q) =>
      (q.intent ?? []).some((intent) =>
        (intent.data ?? []).some(
          (d) => d?.$?.['android:scheme'] === 'google.streetview',
        ),
      ),
    );
    if (!hasStreetView) {
      queries.push({
        intent: [
          {
            action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
            data: [{ $: { 'android:scheme': 'google.streetview' } }],
          },
        ],
      });
    }
    const hasMapsPkg = queries.some((q) =>
      (q.package ?? []).some(
        (p) => p?.$?.['android:name'] === 'com.google.android.apps.maps',
      ),
    );
    if (!hasMapsPkg) {
      queries.push({
        package: [{ $: { 'android:name': 'com.google.android.apps.maps' } }],
      });
    }
    manifest.queries = queries;
    return cfg;
  });
}

function withStreetViewSources(config) {
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

function withStreetViewPackage(config) {
  return withMainApplication(config, (cfg) => {
    let contents = cfg.modResults.contents;
    const importLine = 'import com.gateauto.app.streetview.StreetViewPackage;';
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
    if (!contents.includes('StreetViewPackage()')) {
      if (contents.includes('add(KeepAlivePackage())')) {
        contents = contents.replace(
          'add(KeepAlivePackage())',
          'add(KeepAlivePackage())\n              add(StreetViewPackage())',
        );
      } else if (contents.includes('add(GateAutoCarBluetoothPackage())')) {
        contents = contents.replace(
          'add(GateAutoCarBluetoothPackage())',
          'add(GateAutoCarBluetoothPackage())\n              add(StreetViewPackage())',
        );
      } else if (contents.includes('PackageList(this).packages.apply')) {
        contents = contents.replace(
          /PackageList\(this\)\.packages\.apply\s*\{/,
          (match) => `${match}\n              add(StreetViewPackage())`,
        );
      }
    }
    cfg.modResults.contents = contents;
    return cfg;
  });
}

function withMapsDependency(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes('play-services-maps')) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /dependencies\s*\{/,
        `dependencies {\n    implementation("com.google.android.gms:play-services-maps:19.1.0")`,
      );
    }
    return cfg;
  });
}

function withGoogleMaps(config) {
  config = withMapsKeyManifest(config);
  config = withStreetViewSources(config);
  config = withStreetViewPackage(config);
  config = withMapsDependency(config);
  return config;
}

module.exports = createRunOncePlugin(withGoogleMaps, 'gateauto-google-maps', '1.1.0');
