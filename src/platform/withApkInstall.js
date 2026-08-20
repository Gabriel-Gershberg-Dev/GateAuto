/**
 * Sideload APK installer: REQUEST_INSTALL_PACKAGES + FileProvider.
 * KeepAlivePackage / StreetViewPackage registration is unchanged.
 */
const {
  AndroidConfig,
  createRunOncePlugin,
  withAndroidManifest,
  withDangerousMod,
  withMainApplication,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PACKAGE_PATH = 'com/gateauto/app/apkinstall';
const SRC_DIR = path.join(__dirname, 'apk-install');
const JAVA_FILES = [
  'ApkFileProvider.java',
  'ApkInstallModule.java',
  'ApkInstallPackage.java',
];

function withApkInstallSources(config) {
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
      const xmlDir = path.join(
        cfg.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'res',
        'xml',
      );
      fs.mkdirSync(xmlDir, { recursive: true });
      fs.copyFileSync(
        path.join(SRC_DIR, 'apk_file_paths.xml'),
        path.join(xmlDir, 'apk_file_paths.xml'),
      );
      return cfg;
    },
  ]);
}

function withApkInstallManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    const providers = app.provider ?? [];
    const name = 'com.gateauto.app.apkinstall.ApkFileProvider';
    if (!providers.some((p) => p?.$?.['android:name'] === name)) {
      providers.push({
        $: {
          'android:name': name,
          'android:authorities': '${applicationId}.apkprovider',
          'android:exported': 'false',
          'android:grantUriPermissions': 'true',
        },
        'meta-data': [
          {
            $: {
              'android:name': 'android.support.FILE_PROVIDER_PATHS',
              'android:resource': '@xml/apk_file_paths',
            },
          },
        ],
      });
    }
    app.provider = providers;

    const manifest = cfg.modResults.manifest;
    const queries = manifest.queries ?? [];
    const hasApkView = queries.some((q) =>
      (q.intent ?? []).some((intent) =>
        (intent.data ?? []).some(
          (d) =>
            d?.$?.['android:mimeType'] ===
            'application/vnd.android.package-archive',
        ),
      ),
    );
    if (!hasApkView) {
      queries.push({
        intent: [
          {
            action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
            data: [
              {
                $: {
                  'android:mimeType': 'application/vnd.android.package-archive',
                },
              },
            ],
          },
        ],
      });
    }
    manifest.queries = queries;
    return cfg;
  });
}

function withApkInstallPackage(config) {
  return withMainApplication(config, (cfg) => {
    let contents = cfg.modResults.contents;
    const importLine = 'import com.gateauto.app.apkinstall.ApkInstallPackage;';
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
    if (!contents.includes('ApkInstallPackage()')) {
      if (contents.includes('add(StreetViewPackage())')) {
        contents = contents.replace(
          'add(StreetViewPackage())',
          'add(StreetViewPackage())\n              add(ApkInstallPackage())',
        );
      } else if (contents.includes('add(KeepAlivePackage())')) {
        contents = contents.replace(
          'add(KeepAlivePackage())',
          'add(KeepAlivePackage())\n              add(ApkInstallPackage())',
        );
      } else if (contents.includes('PackageList(this).packages.apply')) {
        contents = contents.replace(
          /PackageList\(this\)\.packages\.apply\s*\{/,
          (match) => `${match}\n              add(ApkInstallPackage())`,
        );
      }
    }
    cfg.modResults.contents = contents;
    return cfg;
  });
}

function withApkInstall(config) {
  config = AndroidConfig.Permissions.withPermissions(config, [
    'android.permission.REQUEST_INSTALL_PACKAGES',
    'android.permission.INTERNET',
  ]);
  config = withApkInstallSources(config);
  config = withApkInstallManifest(config);
  config = withApkInstallPackage(config);
  return config;
}

module.exports = createRunOncePlugin(
  withApkInstall,
  'gateauto-apk-install',
  '1.0.0',
);
