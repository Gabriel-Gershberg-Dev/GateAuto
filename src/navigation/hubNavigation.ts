import { CommonActions, type NavigationProp } from '@react-navigation/native';
import type { RootStackParamList } from './RootNavigator';
import { compactSystemsGatesStack, type HubRouteSnap } from './hubStack';

export { compactSystemsGatesStack } from './hubStack';
export type { HubRouteSnap } from './hubStack';

type HubNav = NavigationProp<RootStackParamList>;

function snapshot(navigation: HubNav): HubRouteSnap[] {
  return navigation.getState().routes.map((route) => ({
    name: route.name as keyof RootStackParamList,
    params: route.params as object | undefined,
  }));
}

function resetTo(navigation: HubNav, routes: HubRouteSnap[]): void {
  const next = compactSystemsGatesStack(routes);
  if (next.length === 0) return;
  navigation.dispatch(
    CommonActions.reset({
      index: next.length - 1,
      routes: next,
    }),
  );
}

/** Open the gates list without stacking a second GatesList. */
export function goToGatesList(navigation: HubNav): void {
  const routes = snapshot(navigation);
  const last = routes[routes.length - 1];
  if (last?.name === 'GatesList') return;
  resetTo(navigation, [...routes, { name: 'GatesList' }]);
}

/** Open gate systems without stacking a second GateSystems. */
export function goToGateSystems(navigation: HubNav): void {
  const routes = snapshot(navigation);
  const last = routes[routes.length - 1];
  if (last?.name === 'GateSystems') return;
  resetTo(navigation, [...routes, { name: 'GateSystems' }]);
}
