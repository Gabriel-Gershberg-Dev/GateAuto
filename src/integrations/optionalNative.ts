/**
 * Bridges UI to parallel geo / bluetooth modules when present.
 * Prefer register*() from App bootstrap; also tries soft require of known paths.
 */

import type { GateConfig } from '../data/gatesStore';

export type ConnectedBtDevice = {
  name?: string;
  address?: string;
  id?: string;
};

export type BtPickerLists = {
  connected: ConnectedBtDevice[];
  bonded: ConnectedBtDevice[];
};

export type CarBluetoothApi = {
  getConnectedDevice?: () => Promise<ConnectedBtDevice | null>;
  getConnectedCarDevice?: () => Promise<ConnectedBtDevice | null>;
  getConnectedCarDevices?: () => Promise<ConnectedBtDevice[]>;
  getBondedCarDevices?: () => Promise<ConnectedBtDevice[]>;
  getCarBluetoothPickerDevices?: () => Promise<BtPickerLists>;
  requestBluetoothPermissions?: () => Promise<boolean>;
};

export type GeofencingApi = {
  startGeofencing?: (gates: GateConfig[]) => Promise<void>;
  stopGeofencing?: () => Promise<void>;
  syncGeofences?: (gates?: GateConfig[]) => Promise<void>;
  startMonitoring?: () => Promise<void>;
  stopMonitoring?: () => Promise<void>;
};

let carBluetoothApi: CarBluetoothApi | null = null;
let geofencingApi: GeofencingApi | null = null;
let autoLoadAttempted = false;

export function registerCarBluetooth(api: CarBluetoothApi): void {
  carBluetoothApi = api;
}

export function registerGeofencing(api: GeofencingApi): void {
  geofencingApi = api;
}

export function getCarBluetoothApi(): CarBluetoothApi | null {
  ensureAutoLoad();
  return carBluetoothApi;
}

export function getGeofencingApi(): GeofencingApi | null {
  ensureAutoLoad();
  return geofencingApi;
}

function ensureAutoLoad(): void {
  if (autoLoadAttempted) return;
  autoLoadAttempted = true;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bt = require('../bluetooth/carBluetooth') as CarBluetoothApi;
    registerCarBluetooth(bt);
  } catch {
    // bluetooth-condition todo not present
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const geo = require('../geo/geofencing') as GeofencingApi;
    registerGeofencing(geo);
  } catch {
    // geofence-engine todo not present
  }
}

export async function tryGetConnectedBtDevice(): Promise<ConnectedBtDevice | null> {
  try {
    ensureAutoLoad();
    const api = carBluetoothApi;
    if (!api) return null;

    if (api.getConnectedDevice) {
      return await api.getConnectedDevice();
    }
    if (api.getConnectedCarDevice) {
      return await api.getConnectedCarDevice();
    }
    if (api.getConnectedCarDevices) {
      const list = await api.getConnectedCarDevices();
      return list[0] ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

/** Connected-now + previously-paired lists for the gate Bluetooth picker. */
export async function tryGetBtPickerDevices(): Promise<BtPickerLists> {
  const empty: BtPickerLists = { connected: [], bonded: [] };
  try {
    ensureAutoLoad();
    const api = carBluetoothApi;
    if (!api) return empty;

    if (api.requestBluetoothPermissions) {
      try {
        await api.requestBluetoothPermissions();
      } catch {
        // continue; lists may be empty
      }
    }

    if (api.getCarBluetoothPickerDevices) {
      return await api.getCarBluetoothPickerDevices();
    }

    const connected = api.getConnectedCarDevices
      ? await api.getConnectedCarDevices()
      : [];
    const bonded = api.getBondedCarDevices
      ? await api.getBondedCarDevices()
      : [];
    const connectedKeys = new Set(
      connected.map(
        (d) =>
          (d.address ?? d.id ?? d.name ?? '').trim().toLowerCase() ||
          (d.name ?? ''),
      ),
    );
    return {
      connected,
      bonded: bonded.filter((d) => {
        const key =
          (d.address ?? d.id ?? d.name ?? '').trim().toLowerCase() ||
          (d.name ?? '');
        return key.length > 0 && !connectedKeys.has(key);
      }),
    };
  } catch {
    return empty;
  }
}

/**
 * Start/sync geofences. Returns whether a real geo module handled the call.
 */
export async function tryStartGeofencing(_gates?: GateConfig[]): Promise<boolean> {
  ensureAutoLoad();
  const api = geofencingApi;
  if (!api) return false;

  if (api.startMonitoring) {
    await api.startMonitoring();
    return true;
  }
  if (api.syncGeofences) {
    await api.syncGeofences();
    return true;
  }
  if (api.startGeofencing && _gates) {
    await api.startGeofencing(_gates);
    return true;
  }
  return false;
}

export async function tryStopGeofencing(): Promise<boolean> {
  ensureAutoLoad();
  const api = geofencingApi;
  if (!api) return false;

  if (api.stopMonitoring) {
    await api.stopMonitoring();
    return true;
  }
  if (api.stopGeofencing) {
    await api.stopGeofencing();
    return true;
  }
  return false;
}

/** Re-register regions without flipping the monitoring flag (gate edits). */
export async function trySyncGeofences(): Promise<boolean> {
  ensureAutoLoad();
  const api = geofencingApi;
  if (!api?.syncGeofences) return false;
  await api.syncGeofences();
  return true;
}
