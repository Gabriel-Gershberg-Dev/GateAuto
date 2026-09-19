/** Compact marks + hidden PalGate name for the gate card / hint sheet. */
export function gateCardMarks(gate: {
  origin?: string | null;
  shareDisabled?: boolean | null;
  name?: string | null;
  nameOverride?: string | null;
  bluetooth?: { required?: boolean | null } | null;
  holdEnabled?: boolean | null;
  radiusMeters?: number | null;
  lat?: number | null;
  lng?: number | null;
}): {
  shared: boolean;
  shareOff: boolean;
  bluetooth: boolean;
  hold: boolean;
  meters: number | null;
  hasPin: boolean;
  hiddenPalGateName: string | null;
} {
  const override = gate.nameOverride?.trim() || '';
  const api = gate.name?.trim() || '';
  return {
    shared: gate.origin === 'shared',
    shareOff: Boolean(gate.shareDisabled),
    bluetooth: Boolean(gate.bluetooth?.required),
    hold: Boolean(gate.holdEnabled),
    meters: typeof gate.radiusMeters === 'number' ? gate.radiusMeters : null,
    hasPin: gate.lat != null && gate.lng != null,
    hiddenPalGateName: override && api && override !== api ? api : null,
  };
}
