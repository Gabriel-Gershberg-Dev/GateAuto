#!/usr/bin/env node
/**
 * Copy keepalive + Android Auto + widget (+ streetview / apk-install) Java
 * into the gitignored android/ tree before assembleRelease. Mirrors Expo
 * config plugins.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ANDROID = path.join(ROOT, 'android');

function copyDirFiles(srcDir, destDir, files) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const file of files) {
    const from = path.join(srcDir, file);
    if (!fs.existsSync(from)) {
      throw new Error(`missing ${from}`);
    }
    fs.copyFileSync(from, path.join(destDir, file));
  }
}

if (!fs.existsSync(ANDROID)) {
  console.error('android/ is missing. Run: npx expo prebuild --platform android');
  process.exit(1);
}

copyDirFiles(
  path.join(ROOT, 'src', 'platform', 'android-keepalive'),
  path.join(ANDROID, 'app', 'src', 'main', 'java', 'com', 'gateauto', 'app', 'keepalive'),
  [
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
  ],
);

copyDirFiles(
  path.join(ROOT, 'src', 'platform', 'android-auto'),
  path.join(ANDROID, 'app', 'src', 'main', 'java', 'com', 'gateauto', 'app', 'car'),
  [
    'GateAutoCarAppService.java',
    'GateAutoCarSession.java',
    'GateAutoCarScreen.java',
  ],
);

copyDirFiles(
  path.join(ROOT, 'src', 'platform', 'android-auto', 'res', 'drawable'),
  path.join(ANDROID, 'app', 'src', 'main', 'res', 'drawable'),
  [
    'ic_car_gate.xml',
    'ic_car_gate_open.xml',
    'ic_car_layout_list.xml',
    'ic_car_layout_grid.xml',
    'ic_car_auto_open_on.xml',
    'ic_car_auto_open_off.xml',
  ],
);

copyDirFiles(
  path.join(ROOT, 'src', 'platform', 'android-auto', 'res', 'values'),
  path.join(ANDROID, 'app', 'src', 'main', 'res', 'values'),
  ['car_colors.xml', 'car_theme.xml'],
);

copyDirFiles(
  path.join(ROOT, 'src', 'platform', 'streetview'),
  path.join(ANDROID, 'app', 'src', 'main', 'java', 'com', 'gateauto', 'app', 'streetview'),
  [
    'GateAutoStreetView.java',
    'GateAutoStreetViewManager.java',
    'StreetViewPackage.java',
  ],
);

copyDirFiles(
  path.join(ROOT, 'src', 'platform', 'apk-install'),
  path.join(ANDROID, 'app', 'src', 'main', 'java', 'com', 'gateauto', 'app', 'apkinstall'),
  [
    'ApkFileProvider.java',
    'ApkInstallModule.java',
    'ApkInstallPackage.java',
  ],
);

copyDirFiles(
  path.join(ROOT, 'src', 'platform', 'android-widget'),
  path.join(ANDROID, 'app', 'src', 'main', 'java', 'com', 'gateauto', 'app', 'widget'),
  [
    'WidgetClosest.java',
    'WidgetRefresh.java',
    'WidgetRenderer.java',
    'WidgetActionReceiver.java',
    'GateAutoWidgetProvider.java',
  ],
);

const widgetRes = [
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
const widgetSrc = path.join(ROOT, 'src', 'platform', 'android-widget');
const resRoot = path.join(ANDROID, 'app', 'src', 'main', 'res');
for (const [from, to] of widgetRes) {
  const dest = path.join(resRoot, to);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(widgetSrc, from), dest);
}

console.log('Copied keepalive, android-auto, widget, streetview, apk-install into android/');
