import type { CarBluetoothDevice, CarBluetoothRequirement } from './types';

function normalize(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeAddress(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/-/g, ':');
}

/** True when `device` satisfies the saved address (preferred) or name. */
export function matchesCarBluetooth(
  device: CarBluetoothDevice,
  required: CarBluetoothRequirement,
): boolean {
  const requiredAddress = normalizeAddress(required.address);
  if (requiredAddress.length > 0) {
    const deviceAddress = normalizeAddress(device.address ?? device.id);
    return deviceAddress.length > 0 && deviceAddress === requiredAddress;
  }

  const requiredName = normalize(required.name);
  if (requiredName.length > 0) {
    return normalize(device.name) === requiredName;
  }

  return false;
}

/** True when a BT-required gate may open: a listed car (OR-list) is connected.
 * Random HID/GATT devices do not count — they are only a way to *see* the listed car.
 * Required with an empty list is fail-closed.
 */
export function listedCarIsConnected(opts: {
  required: boolean;
  listedAddresses: string[];
  listedNames: string[];
  connectedAddresses: string[];
  connectedNames: string[];
}): boolean {
  if (!opts.required) return true;
  const wantAddr = new Set(
    opts.listedAddresses
      .map((a) => a.trim().toLowerCase().replace(/[:\-]/g, ''))
      .filter(Boolean),
  );
  const wantName = new Set(
    opts.listedNames.map((n) => n.trim().toLowerCase()).filter(Boolean),
  );
  if (wantAddr.size === 0 && wantName.size === 0) return false;
  const haveAddr = new Set(
    opts.connectedAddresses
      .map((a) => a.trim().toLowerCase().replace(/[:\-]/g, ''))
      .filter(Boolean),
  );
  const haveName = new Set(
    opts.connectedNames.map((n) => n.trim().toLowerCase()).filter(Boolean),
  );
  for (const a of wantAddr) {
    if (haveAddr.has(a)) return true;
  }
  for (const n of wantName) {
    if (haveName.has(n)) return true;
  }
  return false;
}

/**
 * Location poll may open a BT-required gate only when a listed car is
 * currently connected (not any HID). Non-BT gates always may poll-open.
 */
export function pollAllowsAutoOpen(
  btRequired: boolean,
  listedCarConnected = false,
): boolean {
  if (!btRequired) return true;
  return listedCarConnected;
}

/** True when `device` matches any OR entry in the gate's bluetooth.devices list. */
export function deviceMatchesGateBluetooth(
  device: CarBluetoothDevice,
  devices: Array<{ name?: string; address?: string }>,
): boolean {
  return devices.some((req) =>
    matchesCarBluetooth(device, {
      name: req.name?.trim() || undefined,
      address: req.address?.trim() || undefined,
    }),
  );
}
