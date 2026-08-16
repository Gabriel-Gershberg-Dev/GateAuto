import { Linking, Platform } from 'react-native';

const PACKAGE = 'com.gateauto.app';

async function tryOpenUrl(url: string): Promise<boolean> {
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

async function trySendIntent(action: string): Promise<boolean> {
  if (Platform.OS !== 'android' || typeof Linking.sendIntent !== 'function') {
    return false;
  }
  try {
    await Linking.sendIntent(action);
    return true;
  } catch {
    return false;
  }
}

/** App info screen (One UI: Settings → Apps → GateAuto). */
export async function openAppDetailsSettings(): Promise<void> {
  if (Platform.OS === 'android') {
    const opened = await tryOpenUrl(
      `intent:#Intent;action=android.settings.APPLICATION_DETAILS_SETTINGS;data=package:${PACKAGE};end`,
    );
    if (opened) return;
  }
  await Linking.openSettings();
}

/**
 * System “allow unrestricted / ignore battery optimizations” prompt when available,
 * else the battery-optimization list, else app details.
 */
export async function openBatteryUnrestrictedPrompt(): Promise<void> {
  if (Platform.OS !== 'android') {
    await Linking.openSettings();
    return;
  }

  const requested = await tryOpenUrl(
    `intent:#Intent;action=android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS;data=package:${PACKAGE};end`,
  );
  if (requested) return;

  if (await trySendIntent('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS')) {
    return;
  }

  await openAppDetailsSettings();
}

/**
 * Samsung Device Care / battery screens (One UI). Falls back to app details.
 */
export async function openSamsungDeviceCareBattery(): Promise<void> {
  if (Platform.OS !== 'android') {
    await Linking.openSettings();
    return;
  }

  const candidates = [
    'intent:#Intent;component=com.samsung.android.lool/com.samsung.android.sm.battery.ui.BatteryActivity;end',
    'intent:#Intent;component=com.samsung.android.lool/com.samsung.android.sm.ui.battery.BatteryActivity;end',
    'intent:#Intent;component=com.samsung.android.sm/com.samsung.android.sm.ui.battery.BatteryActivity;end',
  ];

  for (const url of candidates) {
    if (await tryOpenUrl(url)) return;
  }

  await openAppDetailsSettings();
}
