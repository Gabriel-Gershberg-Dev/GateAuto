export type HubRouteSnap = {
  name: string;
  params?: object;
};

/**
 * Keep at most one GatesList and one GateSystems. Repeating
 * navigate() on native-stack otherwise pushes forever:
 * Gates → Systems → Gates → Systems …
 */
export function compactSystemsGatesStack<T extends HubRouteSnap>(routes: T[]): T[] {
  const out: T[] = [];
  for (const route of routes) {
    if (route.name === 'GatesList' || route.name === 'GateSystems') {
      const prev = out.findIndex((r) => r.name === route.name);
      if (prev >= 0) out.splice(prev, 1);
    }
    out.push(route);
  }
  return out;
}

/**
 * After an invite Done / accept: land on the gates list when any gates exist.
 * Gates as root, or Systems under Gates so back returns once — never the empty
 * “Add gate system” hub while loadGates() is non-empty.
 */
export function hubRoutesAfterInvite(input: {
  gateCount: number;
  systemCount: number;
}): HubRouteSnap[] {
  if (input.gateCount > 0) {
    return compactSystemsGatesStack(
      input.systemCount > 0
        ? [{ name: 'GateSystems' }, { name: 'GatesList' }]
        : [{ name: 'GatesList' }],
    );
  }
  return [{ name: 'GateSystems' }];
}
