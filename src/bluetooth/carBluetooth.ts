import {
  PermissionsAndroid,
  Platform,
  type Permission,
  type PermissionStatus,
} from 'react-native';
import {
  getAndroidProfileConnectedDevices,
  isAndroidProfileBluetoothAvailable,
} from './androidProfiles';
import { matchesCarBluetooth } from './match';
import {
  BLUETOOTH_NATIVE_REQUIRED_MESSAGE,
  getRNBluetoothClassic,
  isBluetoothNativeAvailable,
} from './rnBluetoothClassic';
import type { CarBluetoothDevice, CarBluetoothRequirement } from './types';
import { getAutoOpenOsStatus } from '../platform/keepAliveAlarm';
import {
  bluetoothPermissionGranted,
  needsRuntimeBluetoothPermission,
} from '../permissions/permissionStatusLogic';

export type { CarBluetoothDevice, CarBluetoothRequirement };
export {
  BLUETOOTH_NATIVE_REQUIRED_MESSAGE,
  isBluetoothNativeAvailable,
};

/** Sectioned lists for the Gate Editor Bluetooth picker. */
export type CarBluetoothPickerLists = {
  connected: CarBluetoothDevice[];
  /** Bonded/paired devices that are not already in `connected`. */
  bonded: CarBluetoothDevice[];
};

function toCarDevice(device: {
  id?: string;
  address?: string;
  name?: string;
}): CarBluetoothDevice | null {
  const name = (device.name ?? device.address ?? device.id ?? '').trim();
  if (!name) {
    return null;
  }
  const address = device.address?.trim() || undefined;
  const id = device.id?.trim() || address;
  return { id, address, name };
}

function deviceKey(device: CarBluetoothDevice): string {
  return (
    (device.address ?? device.id ?? device.name).trim().toLowerCase() ||
    device.name
  );
}

function dedupeDevices(devices: CarBluetoothDevice[]): CarBluetoothDevice[] {
  const seen = new Set<string>();
  const out: CarBluetoothDevice[] = [];
  for (const device of devices) {
    const key = deviceKey(device);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(device);
  }
  return out;
}

function androidApiLevel(): number {
  return typeof Platform.Version === 'number'
    ? Platform.Version
    : parseInt(String(Platform.Version), 10);
}

async function isAndroidPermissionGranted(
  permission: Permission,
): Promise<boolean> {
  try {
    return await PermissionsAndroid.check(permission);
  } catch {
    return false;
  }
}

/** True when car-BT matching can read connected / bonded devices without a new prompt. */
export async function hasBluetoothPermissions(): Promise<boolean> {
  try {
    if (Platform.OS !== 'android') {
      // iOS prompts on first native access; do not treat as a blocking gap.
      return true;
    }
    const os = await getAutoOpenOsStatus();
    if (os) {
      return bluetoothPermissionGranted({
        sdkInt: os.sdkInt,
        connectGranted: os.bluetoothConnectGranted,
        adapterEnabled: os.bluetoothAdapterEnabled,
      });
    }
    if (!needsRuntimeBluetoothPermission(androidApiLevel())) return true;
    const connect = PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT;
    if (typeof connect !== 'string' || !connect) return false;
    return await isAndroidPermissionGranted(connect);
  } catch {
    return false;
  }
}

/**
 * Request runtime Bluetooth permissions needed to read connected / bonded devices.
 * - Android 12+: BLUETOOTH_CONNECT (+ SCAN)
 * - Older Android: install-time BT permissions (always true once installed)
 * - iOS: triggers system prompt via first native BT access; Info.plist usage strings required
 * - Web / missing native module: false
 *
 * Never throws — permission dialogs can recreate the activity; callers must stay resilient.
 */
export async function requestBluetoothPermissions(): Promise<boolean> {
  try {
    if (Platform.OS === 'android') {
      if (!needsRuntimeBluetoothPermission(androidApiLevel())) {
        // Pre-Android 12: BLUETOOTH / BLUETOOTH_ADMIN are install-time permissions.
        return true;
      }

      const connect = PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT;
      const scan = PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN;
      const wanted: Permission[] = [connect, scan].filter(
        (p): p is Permission => typeof p === 'string' && p.length > 0,
      );

      if (wanted.length === 0) {
        return false;
      }

      const already = await Promise.all(
        wanted.map((p) => isAndroidPermissionGranted(p)),
      );
      if (already.every(Boolean)) {
        return true;
      }

      let result: { [key in Permission]?: PermissionStatus } = {};
      try {
        result = await PermissionsAndroid.requestMultiple(wanted);
      } catch {
        // requestMultiple can fail if the activity was destroyed during the dialog.
        // Fall back to one-at-a-time requests.
        for (const permission of wanted) {
          try {
            if (await isAndroidPermissionGranted(permission)) {
              result[permission] = PermissionsAndroid.RESULTS.GRANTED;
              continue;
            }
            result[permission] = await PermissionsAndroid.request(permission);
          } catch {
            result[permission] = PermissionsAndroid.RESULTS.DENIED;
          }
        }
      }

      // CONNECT is required to read bonded/connected device names + MACs.
      // SCAN is best-effort (discovery); do not fail the flow if only SCAN is denied.
      const connectStatus =
        result[connect] ??
        ((await isAndroidPermissionGranted(connect))
          ? PermissionsAndroid.RESULTS.GRANTED
          : PermissionsAndroid.RESULTS.DENIED);

      return connectStatus === PermissionsAndroid.RESULTS.GRANTED;
    }

    if (Platform.OS === 'ios') {
      const bt = getRNBluetoothClassic();
      if (!bt) {
        return false;
      }
      try {
        await bt.isBluetoothEnabled();
        return true;
      } catch {
        return false;
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Currently connected classic Bluetooth devices suitable for the Gate Editor picker
 * and geofence BT gate.
 *
 * Platform notes:
 * - Android: prefers A2DP/HEADSET/GATT profile connections via GateAutoCarBluetooth
 *   (config plugin), then merges `react-native-bluetooth-classic` RFCOMM sockets.
 * - iOS: merges open sessions with EAAccessory `connectedAccessories` (library
 *   `getBondedDevices` on iOS). Match by accessory **name**; no public classic MAC API.
 * - Requires a Dev Client / `expo prebuild` (Expo Go returns []). See
 *   {@link BLUETOOTH_NATIVE_REQUIRED_MESSAGE}.
 */
export async function getConnectedCarDevices(): Promise<CarBluetoothDevice[]> {
  const mapped: CarBluetoothDevice[] = [];

  try {
    if (Platform.OS === 'android') {
      try {
        const profileDevices = await getAndroidProfileConnectedDevices();
        mapped.push(...profileDevices);
      } catch {
        // Profile helper optional / may throw without CONNECT.
      }
    }

    const bt = getRNBluetoothClassic();
    if (!bt) {
      return dedupeDevices(mapped);
    }

    try {
      const connected = await bt.getConnectedDevices();
      for (const device of connected) {
        const car = toCarDevice(device);
        if (car) {
          mapped.push(car);
        }
      }
    } catch {
      // RFCOMM session list unavailable.
    }

    // On iOS, getBondedDevices lists currently connected EAAccessories (not the
    // Android-style paired list). Prefer those for in-car name matching.
    if (Platform.OS === 'ios') {
      try {
        const accessories = await bt.getBondedDevices();
        for (const device of accessories) {
          const car = toCarDevice(device);
          if (car) {
            mapped.push(car);
          }
        }
      } catch {
        // EAAccessory list unavailable.
      }
    }

    return dedupeDevices(mapped);
  } catch {
    return dedupeDevices(mapped);
  }
}

/**
 * Bonded / previously paired classic Bluetooth devices (Android paired list).
 * On iOS this overlaps with connected EAAccessories — still safe to call.
 * Never throws; returns [] when native BT or permissions are unavailable.
 */
export async function getBondedCarDevices(): Promise<CarBluetoothDevice[]> {
  const mapped: CarBluetoothDevice[] = [];
  try {
    const bt = getRNBluetoothClassic();
    if (!bt) {
      return [];
    }
    const bonded = await bt.getBondedDevices();
    for (const device of bonded) {
      const car = toCarDevice(device);
      if (car) {
        mapped.push(car);
      }
    }
    return dedupeDevices(mapped);
  } catch {
    return [];
  }
}

/**
 * Lists devices for the Gate Editor picker:
 * - Connected now (profiles + RFCOMM / iOS accessories)
 * - Previously paired (Android bonded), excluding ones already listed as connected
 *
 * Requests BT permissions first; never throws.
 */
export async function getCarBluetoothPickerDevices(): Promise<CarBluetoothPickerLists> {
  try {
    await requestBluetoothPermissions();
  } catch {
    // ignore — list may still be empty without permission
  }

  let connected: CarBluetoothDevice[] = [];
  let bonded: CarBluetoothDevice[] = [];

  try {
    connected = await getConnectedCarDevices();
  } catch {
    connected = [];
  }

  try {
    // Android: true paired history. iOS: connected accessories (same as library API).
    if (Platform.OS === 'android' || Platform.OS === 'ios') {
      bonded = await getBondedCarDevices();
    }
  } catch {
    bonded = [];
  }

  const connectedKeys = new Set(connected.map(deviceKey));
  const bondedOnly = bonded.filter((d) => !connectedKeys.has(deviceKey(d)));

  return {
    connected: dedupeDevices(connected),
    bonded: dedupeDevices(bondedOnly),
  };
}

function hasMatchCriteria(required: CarBluetoothRequirement): boolean {
  return Boolean(required.address?.trim() || required.name?.trim());
}

/**
 * Tri-state car-BT read:
 * - `connected`: a listed car (OR list) is currently connected.
 * - `not_connected`: the connected-device list was read successfully and no
 *   listed car is in it.
 * - `unknown`: the connection state could NOT be read — no native BT module,
 *   `BLUETOOTH_CONNECT` not granted (Android 12+ returns empty/throws without
 *   it, which is indistinguishable from "car not connected"), or a read
 *   exception. Callers must not hard-block a BT-required open on `unknown`
 *   alone; proximity still gates the open.
 */
export type CarBluetoothConnectionState =
  | 'connected'
  | 'not_connected'
  | 'unknown';

export async function readCarBluetoothConnection(
  required: CarBluetoothRequirement | CarBluetoothRequirement[],
): Promise<CarBluetoothConnectionState> {
  const requirements = (Array.isArray(required) ? required : [required]).filter(
    hasMatchCriteria,
  );
  if (requirements.length === 0) {
    // Nothing to match against — a config problem, not a read failure.
    return 'not_connected';
  }

  if (!isBluetoothNativeAvailable() && !isAndroidProfileBluetoothAvailable()) {
    // No way to read connection state (Expo Go / no prebuild).
    return 'unknown';
  }

  // Android 12+: without BLUETOOTH_CONNECT the connected/bonded queries return
  // empty or throw. That looks identical to "not connected", so a missing
  // permission would silently block every BT-required open. Report unknown so
  // the caller can fall open on proximity instead of hard-blocking.
  if (Platform.OS === 'android' && !(await hasBluetoothPermissions())) {
    return 'unknown';
  }

  try {
    const bt = getRNBluetoothClassic();
    if (bt && Platform.OS === 'android') {
      for (const req of requirements) {
        const address = req.address?.trim();
        if (!address) continue;
        try {
          if (await bt.isDeviceConnected(address)) {
            return 'connected';
          }
        } catch {
          // Fall through to list matching (profile + classic).
        }
      }
    }

    const connected = await getConnectedCarDevices();
    const matched = requirements.some((req) =>
      connected.some((device) => matchesCarBluetooth(device, req)),
    );
    return matched ? 'connected' : 'not_connected';
  } catch {
    return 'unknown';
  }
}

/**
 * Whether any required car Bluetooth device is among currently connected devices (OR).
 * Prefers MAC `address` (Android), falls back to case-insensitive `name` (iOS / Android).
 * Accepts a single requirement or a list. Returns false when native BT is unavailable,
 * criteria are empty, or no configured device matches. Prefer
 * {@link readCarBluetoothConnection} when you need to distinguish
 * "not connected" from "could not read".
 */
export async function isCarBluetoothConnected(
  required: CarBluetoothRequirement | CarBluetoothRequirement[],
): Promise<boolean> {
  return (await readCarBluetoothConnection(required)) === 'connected';
}
