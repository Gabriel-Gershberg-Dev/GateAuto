/** Device identity stored on a gate and returned by the car-BT picker APIs. */
export type CarBluetoothDevice = {
  id?: string;
  address?: string;
  name: string;
};

/** Match criteria: prefer MAC `address`, fall back to `name`. */
export type CarBluetoothRequirement = {
  address?: string;
  name?: string;
};
