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
