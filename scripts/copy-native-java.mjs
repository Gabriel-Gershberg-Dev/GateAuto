#!/usr/bin/env node
/**
 * Copy keepalive + Android Auto (+ streetview / apk-install) Java into the
 * gitignored android/ tree before assembleRelease. Mirrors Expo config plugins.
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

console.log('Copied keepalive, android-auto, streetview, apk-install into android/');
