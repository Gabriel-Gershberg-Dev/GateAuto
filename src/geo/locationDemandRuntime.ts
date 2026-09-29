import { getConnectedCarDevices } from '../bluetooth/carBluetooth';
import { listedCarConnectedForAutoGates, type LocationDemandBtGate } from '../data/locationDemand';
import type { GateConfig } from '../data/gatesStore';
import { getNativeNeedsContinuousLocation } from '../platform/keepAliveAlarm';

function hasPin(g: GateConfig): boolean {
  return (
    typeof g.lat === 'number' &&
    Number.isFinite(g.lat) &&
    typeof g.lng === 'number' &&
    Number.isFinite(g.lng) &&
    Number.isFinite(g.radiusMeters) &&
    g.radiusMeters > 0
  );
}

export function demandGatesFromConfigs(gates: GateConfig[]): LocationDemandBtGate[] {
  return gates.map((g) => {
    const devices = g.bluetooth?.devices ?? [];
    return {
      autoEnabled: Boolean(g.enabled) && !g.shareDisabled,
      btRequired: Boolean(g.bluetooth?.required),
      hasPin: hasPin(g),
      listedAddresses: devices.map((d) => String(d.address ?? '').trim()),
      listedNames: devices.map((d) => String(d.name ?? '').trim()),
    };
  });
}

/**
 * JS mirror of {@code LocationDemand.needsContinuousLocation}.
 * On Android, native is the source of truth so Expo cannot start GPS when
 * Java has already decided we are waiting for a listed car.
 */
export async function jsNeedsContinuousLocation(
  armed: boolean,
  gates: GateConfig[],
): Promise<boolean> {
  const native = await getNativeNeedsContinuousLocation();
  if (native !== null) return Boolean(native);

  const demandGates = demandGatesFromConfigs(gates);
  const auto = demandGates.filter((g) => g.autoEnabled && g.hasPin !== false);
  if (!armed || auto.length === 0) return false;
  if (auto.some((g) => !g.btRequired)) return true;

  let connected: Awaited<ReturnType<typeof getConnectedCarDevices>> = [];
  try {
    connected = await getConnectedCarDevices();
  } catch {
    return false;
  }
  return listedCarConnectedForAutoGates(
    demandGates,
    connected.map((d) => d.address ?? ''),
    connected.map((d) => d.name ?? ''),
  );
}
