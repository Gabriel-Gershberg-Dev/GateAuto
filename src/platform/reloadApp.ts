import { DevSettings, NativeModules, Platform } from 'react-native';

type RecreateNative = {
  recreateActivity?: () => Promise<boolean>;
};

/**
 * Reload so I18nManager RTL / LTR applies. Release APK uses the existing
 * KeepAlive native module to recreate the activity (no Play Store update).
 * Does not stop KeepAliveService or geofences — same process.
 */
export async function reloadAppForLayout(): Promise<void> {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    try {
      DevSettings.reload();
      return;
    } catch {
      // Some debug builds still need the native path.
    }
  }

  if (Platform.OS === 'android') {
    const native = NativeModules.GateAutoKeepAlive as RecreateNative | undefined;
    if (typeof native?.recreateActivity === 'function') {
      await native.recreateActivity();
      return;
    }
  }

  const restart = NativeModules.RNRestart as
    | { Restart?: () => void }
    | undefined;
  if (typeof restart?.Restart === 'function') {
    restart.Restart();
  }
}
