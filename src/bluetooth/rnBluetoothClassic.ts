import { NativeModules, Platform } from 'react-native';

type ConnectedNativeDevice = {
  id?: string;
  address?: string;
  name?: string;
};

type RNBluetoothClassicModule = {
  isBluetoothEnabled(): Promise<boolean>;
  getConnectedDevices(): Promise<ConnectedNativeDevice[]>;
  getBondedDevices(): Promise<ConnectedNativeDevice[]>;
  isDeviceConnected(address: string): Promise<boolean>;
};

/**
 * react-native-bluetooth-classic requires a custom Dev Client / `expo prebuild`
 * (Expo Go does not include RNBluetoothClassic). When the native module is missing,
 * callers get empty lists / false rather than a hard crash.
 */
export const BLUETOOTH_NATIVE_REQUIRED_MESSAGE =
  'Car Bluetooth requires a development build (npx expo prebuild && npx expo run:android|ios). Expo Go does not include react-native-bluetooth-classic.';

export function isBluetoothNativeAvailable(): boolean {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    return false;
  }
  return NativeModules.RNBluetoothClassic != null;
}

let cached: RNBluetoothClassicModule | null | undefined;

/** Lazily load the default RNBluetoothClassic singleton when the native module exists. */
export function getRNBluetoothClassic(): RNBluetoothClassicModule | null {
  if (cached !== undefined) {
    return cached;
  }
  if (!isBluetoothNativeAvailable()) {
    cached = null;
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-bluetooth-classic') as {
      default: RNBluetoothClassicModule;
    };
    cached = mod.default ?? null;
  } catch {
    cached = null;
  }
  return cached;
}
