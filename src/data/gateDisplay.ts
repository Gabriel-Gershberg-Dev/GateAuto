/** Label shown in lists/editor: override if set, else PalGate name. */
export function displayGateName(gate: {
  name?: string | null;
  nameOverride?: string | null;
  deviceId: string;
}): string {
  const override = gate.nameOverride?.trim();
  if (override) return override;
  const apiName = gate.name?.trim();
  if (apiName) return apiName;
  return gate.deviceId;
}
