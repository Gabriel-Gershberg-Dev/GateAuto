/**
 * Bluetooth connection → auto-open while already inside a home geofence.
 * Primary trigger when the fence covers the house (always "inside").
 */

import { Platform } from 'react-native';
import {
  addAndroidBtConnectedListener,
  startAndroidBtConnectionListening,
  stopAndroidBtConnectionListening,
} from './androidProfiles';
import { deviceMatchesGateBluetooth } from './match';
import {
  getRNBluetoothClassic,
  isBluetoothNativeAvailable,
} from './rnBluetoothClassic';
import type { CarBluetoothDevice } from './types';

type BtConnectHandler = (device: CarBluetoothDevice) => void | Promise<void>;

let handler: BtConnectHandler | null = null;
let androidSub: { remove: () => void } | null = null;
let classicSub: { remove: () => void } | null = null;
let started = false;
let handling = false;

function toCarDevice(raw: {
  id?: string;
  address?: string;
  name?: string;
}): CarBluetoothDevice | null {
  const name = (raw.name ?? raw.address ?? raw.id ?? '').trim();
  if (!name) return null;
  const address = raw.address?.trim() || undefined;
  const id = raw.id?.trim() || address;
  return { id, address, name };
}

async function onConnected(device: CarBluetoothDevice): Promise<void> {
  if (!handler) return;
  if (handling) {
    console.log('[GateAuto] bt-connect ignored — open already in progress');
    return;
  }
  handling = true;
  try {
    await handler(device);
  } catch (error) {
    console.warn('[GateAuto] bt-connect handler failed', error);
  } finally {
    handling = false;
  }
}

/**
 * Register the open-pipeline callback (from geo). Safe to call repeatedly.
 */
export function setBluetoothConnectHandler(next: BtConnectHandler | null): void {
  handler = next;
}

/**
 * Start ACL / profile / classic connection listeners (Android primary).
 * Idempotent. Call when monitoring turns ON / syncs.
 */
export async function startBluetoothConnectMonitor(): Promise<void> {
  if (started) {
    // Ensure native receiver is up after process resume.
    if (Platform.OS === 'android') {
      await startAndroidBtConnectionListening();
    }
    return;
  }
  started = true;

  if (Platform.OS === 'android') {
    androidSub = addAndroidBtConnectedListener((device) => {
      void onConnected(device);
    });
    await startAndroidBtConnectionListening();
  }

  // Best-effort: RFCOMM classic events (rarely fires for car A2DP, but cheap).
  if (isBluetoothNativeAvailable()) {
    try {
      const bt = getRNBluetoothClassic() as {
        onDeviceConnected?: (
          listener: (event: { device?: { id?: string; address?: string; name?: string } }) => void,
        ) => { remove: () => void };
      } | null;
      if (bt?.onDeviceConnected) {
        classicSub = bt.onDeviceConnected((event) => {
          const device = toCarDevice(event?.device ?? {});
          if (device) void onConnected(device);
        });
      }
    } catch (error) {
      console.warn('[GateAuto] classic onDeviceConnected failed', error);
    }
  }

  console.log('[GateAuto] BT connect monitor started');
}

export async function stopBluetoothConnectMonitor(): Promise<void> {
  androidSub?.remove();
  androidSub = null;
  classicSub?.remove();
  classicSub = null;
  started = false;
  if (Platform.OS === 'android') {
    await stopAndroidBtConnectionListening();
  }
  console.log('[GateAuto] BT connect monitor stopped');
}

/** Whether the BT-connect monitor listeners are currently started. */
export function isBluetoothConnectMonitorStarted(): boolean {
  return started;
}

export { deviceMatchesGateBluetooth };
