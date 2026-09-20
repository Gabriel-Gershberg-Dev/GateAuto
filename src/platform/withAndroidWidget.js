/**
 * Expo config plugin: Android home-screen widget (closest pinned gate).
 *
 * Copies native sources into android/ on prebuild. Same pattern as
 * withAndroidAuto.js / withAndroidKeepAlive.js.
 *
 * iOS WidgetKit is out of scope. This comment is the hook — do not add a
 * WidgetKit target until asked.
 */
const {
  AndroidConfig,
  createRunOncePlugin,
  withAndroidManifest,
  withDangerousMod,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PACKAGE_PATH = 'com/gateauto/app/widget';
const SRC_DIR = path.join(__dirname, 'android-widget');
const JAVA_FILES = [
  'WidgetClosest.java',
  'WidgetRefresh.java',
  'WidgetRenderer.java',
  'WidgetActionReceiver.java',
  'GateAutoWidgetProvider.java',
];
const RES_FILES = [
  ['res/xml/gateauto_widget_info.xml', 'xml/gateauto_widget_info.xml'],
  ['res/layout/widget_hero.xml', 'layout/widget_hero.xml'],
  ['res/layout/widget_row.xml', 'layout/widget_row.xml'],
  ['res/layout/widget_list.xml', 'layout/widget_list.xml'],
  ['res/drawable/widget_face.xml', 'drawable/widget_face.xml'],
  ['res/drawable/widget_open_pill.xml', 'drawable/widget_open_pill.xml'],
  ['res/drawable/widget_chip.xml', 'drawable/widget_chip.xml'],
  ['res/drawable/widget_row_well.xml', 'drawable/widget_row_well.xml'],
  ['res/drawable/ic_widget_gate.xml', 'drawable/ic_widget_gate.xml'],
  ['res/values/widget_colors.xml', 'values/widget_colors.xml'],
  ['res/values/widget_dimens.xml', 'values/widget_dimens.xml'],
  ['res/values-v31/widget_dimens.xml', 'values-v31/widget_dimens.xml'],
  ['res/values/widget_strings.xml', 'values/widget_strings.xml'],
  ['res/values-he/widget_strings.xml', 'values-he/widget_strings.xml'],
  ['res/values-ru/widget_strings.xml', 'values-ru/widget_strings.xml'],
];

function copyWidgetSources(config) {
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

function upsertReceiver(app, name, attrs, intentFilter, extraMeta) {
  const receivers = app.receiver ?? [];
  const existing = receivers.find((r) => r?.$?.['android:name'] === name);
  if (existing) {
    Object.assign(existing.$, attrs);
    if (intentFilter) existing['intent-filter'] = intentFilter;
    if (extraMeta) existing['meta-data'] = extraMeta;
    app.receiver = receivers;
    return;
  }
  const node = { $: { 'android:name': name, ...attrs } };
  if (intentFilter) node['intent-filter'] = intentFilter;
  if (extraMeta) node['meta-data'] = extraMeta;
  receivers.push(node);
  app.receiver = receivers;
}

function withWidgetManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    upsertReceiver(
      app,
      'com.gateauto.app.widget.GateAutoWidgetProvider',
      {
        'android:exported': 'true',
        'android:label': '@string/widget_name',
      },
      [
        {
          action: [{ $: { 'android:name': 'android.appwidget.action.APPWIDGET_UPDATE' } }],
        },
      ],
      [
        {
          $: {
            'android:name': 'android.appwidget.provider',
            'android:resource': '@xml/gateauto_widget_info',
          },
        },
      ],
    );
    upsertReceiver(
      app,
      'com.gateauto.app.widget.WidgetActionReceiver',
      {
        'android:exported': 'false',
        'android:enabled': 'true',
      },
    );
    return cfg;
  });
}

function withAndroidWidget(config) {
  config = copyWidgetSources(config);
  config = withWidgetManifest(config);
  return config;
}

module.exports = createRunOncePlugin(withAndroidWidget, 'gateauto-android-widget', '1.0.0');
