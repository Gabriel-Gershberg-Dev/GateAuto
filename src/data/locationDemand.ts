import { listedCarIsConnected } from '../bluetooth/match';

/**
 * When Auto-open may run a continuous GPS stream.
 * Mirrored by {@code LocationDemand.java}.
 *
 * Manual (auto-off) gates never demand location. If every auto-on gate
 * requires a listed car, wait for that car — do not hunt GPS in the meantime.
 */
export type LocationDemandGate = {
  autoEnabled: boolean;
  btRequired: boolean;
  /** Auto-on gates without a pin cannot use GPS and must not demand it. */
  hasPin?: boolean;
};

export type LocationDemandBtGate = LocationDemandGate & {
  listedAddresses: string[];
  listedNames: string[];
};

export function needsContinuousLocation(input: {
  armed: boolean;
  gates: LocationDemandGate[];
  listedCarConnected: boolean;
}): boolean {
  if (!input.armed) return false;
  const auto = input.gates.filter((g) => g.autoEnabled && g.hasPin !== false);
  if (auto.length === 0) return false;
  if (auto.some((g) => !g.btRequired)) return true;
  return Boolean(input.listedCarConnected);
}

/** True when a listed car for at least one auto-on, BT-required gate is connected. */
export function listedCarConnectedForAutoGates(
  gates: LocationDemandBtGate[],
  connectedAddresses: string[],
  connectedNames: string[],
): boolean {
  for (const gate of gates) {
    if (!gate.autoEnabled || !gate.btRequired) continue;
    if (
      listedCarIsConnected({
        required: true,
        listedAddresses: gate.listedAddresses,
        listedNames: gate.listedNames,
        connectedAddresses,
        connectedNames,
      })
    ) {
      return true;
    }
  }
  return false;
}
