/** One car Bluetooth identity that may satisfy the gate BT check. */
export type GateBluetoothDevice = {
  name?: string;
  address?: string;
};

/**
 * Car Bluetooth gate filter. When `required`, auto-open passes if ANY
 * configured device is connected (OR). Empty `devices` while required fails closed.
 */
export type GateBluetoothConfig = {
  required: boolean;
  devices: GateBluetoothDevice[];
};

export function defaultBluetooth(): GateBluetoothConfig {
  return { required: false, devices: [] };
}

function normalizeBluetoothDevice(
  raw: Partial<GateBluetoothDevice> | null | undefined,
): GateBluetoothDevice | null {
  if (!raw || typeof raw !== 'object') return null;
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const address = typeof raw.address === 'string' ? raw.address.trim() : '';
  if (!name && !address) return null;
  return {
    ...(name ? { name } : {}),
    ...(address ? { address } : {}),
  };
}

/**
 * Normalize bluetooth config. Migrates legacy `{ required, name, address }`
 * into `{ required, devices: [{ name?, address? }] }`.
 */
export function normalizeBluetooth(raw: unknown): GateBluetoothConfig {
  if (!raw || typeof raw !== 'object') return defaultBluetooth();
  const bt = raw as {
    required?: unknown;
    name?: unknown;
    address?: unknown;
    devices?: unknown;
  };
  const required = Boolean(bt.required);
  let devices: GateBluetoothDevice[] = [];

  if (Array.isArray(bt.devices)) {
    for (const item of bt.devices) {
      const device = normalizeBluetoothDevice(
        item as Partial<GateBluetoothDevice>,
      );
      if (device) devices.push(device);
    }
  }

  // Legacy single name/address → devices[0]
  if (devices.length === 0) {
    const legacy = normalizeBluetoothDevice({
      name: typeof bt.name === 'string' ? bt.name : undefined,
      address: typeof bt.address === 'string' ? bt.address : undefined,
    });
    if (legacy) devices = [legacy];
  }

  return { required, devices };
}
