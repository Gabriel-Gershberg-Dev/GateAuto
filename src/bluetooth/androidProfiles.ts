import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';
import type { CarBluetoothDevice } from './types';

type GateAutoCarBluetoothNative = {
  getProfileConnectedDevices(): Promise<
    Array<{ id?: string; address?: string; name: string }>
  >;
  startConnectionListening?: () => Promise<boolean>;
  stopConnectionListening?: () => Promise<boolean>;
};

export const ANDROID_BT_CONNECTED_EVENT = 'GateAutoBluetoothDeviceConnected';

function getNative(): GateAutoCarBluetoothNative | null {
  if (Platform.OS !== 'android') {
    return null;
  }
  const mod = NativeModules.GateAutoCarBluetooth as
    | GateAutoCarBluetoothNative
    | undefined;
  return mod ?? null;
}

/** True after prebuild when the GateAutoCarBluetooth package is registered. */
export function isAndroidProfileBluetoothAvailable(): boolean {
  return getNative() != null;
}

/**
 * Android A2DP / HEADSET / GATT connected devices (typical car Bluetooth).
 * Empty when the native helper is not in the binary (Expo Go / no prebuild).
 */
export async function getAndroidProfileConnectedDevices(): Promise<
  CarBluetoothDevice[]
> {
  const native = getNative();
  if (!native) {
    return [];
  }
  try {
    const devices = await native.getProfileConnectedDevices();
    const out: CarBluetoothDevice[] = [];
    for (const device of devices) {
      const name = (device.name ?? device.address ?? device.id ?? '').trim();
      if (!name) {
        continue;
      }
      const address = device.address?.trim() || undefined;
      const id = device.id?.trim() || address;
      out.push({ id, address, name });
    }
    return out;
  } catch {
    return [];
  }
}

/** Register dynamic ACL / A2DP / HEADSET receivers (Android only). */
export async function startAndroidBtConnectionListening(): Promise<boolean> {
  const native = getNative();
  if (!native?.startConnectionListening) return false;
  try {
    await native.startConnectionListening();
    return true;
  } catch (error) {
    console.warn('[GateAuto] startAndroidBtConnectionListening failed', error);
    return false;
  }
}

export async function stopAndroidBtConnectionListening(): Promise<void> {
  const native = getNative();
  if (!native?.stopConnectionListening) return;
  try {
    await native.stopConnectionListening();
  } catch (error) {
    console.warn('[GateAuto] stopAndroidBtConnectionListening failed', error);
  }
}

/**
 * Subscribe to native car-BT connect events. Returns remove() or null when
 * the module is unavailable (Expo Go / iOS).
 */
export function addAndroidBtConnectedListener(
  listener: (device: CarBluetoothDevice) => void,
): { remove: () => void } | null {
  if (!getNative()) return null;

  const sub = DeviceEventEmitter.addListener(
    ANDROID_BT_CONNECTED_EVENT,
    (raw: { id?: string; address?: string; name?: string } | null) => {
      if (!raw) return;
      const name = (raw.name ?? raw.address ?? raw.id ?? '').trim();
      if (!name) return;
      const address = raw.address?.trim() || undefined;
      const id = raw.id?.trim() || address;
      listener({ id, address, name });
    },
  );

  return { remove: () => sub.remove() };
}
