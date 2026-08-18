import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { loadGates } from '../data/gatesStore';
import { listSystems } from '../data/palgateSystems';
import { initialHubRoute } from '../data/vaultRecoverLogic';
import { useTheme } from '../ui/ThemeProvider';
import { GateSystemsScreen } from '../ui/screens/GateSystemsScreen';
import { GatesListScreen } from '../ui/screens/GatesListScreen';
import { LinkAccountScreen } from '../ui/screens/LinkAccountScreen';
import { MonitoringScreen } from '../ui/screens/MonitoringScreen';
import { PermissionsScreen } from '../ui/screens/PermissionsScreen';
import { SignInScreen } from '../ui/screens/SignInScreen';

export type RootStackParamList = {
  SignIn: undefined;
  GateSystems: undefined;
  LinkAccount: { purpose?: 'primary' | 'additional' } | undefined;
  ExportAccount: { continueTo?: 'Permissions' } | undefined;
  Permissions: undefined;
  GatesList: undefined;
  GateEditor: { gateId: string };
  ShareGate: { gateId?: string; gateIds?: string[] };
  Monitoring: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { colors, navigationTheme } = useTheme();
  const { user, ready } = useAuth();
  const [hubRoute, setHubRoute] = useState<'GateSystems' | 'GatesList' | null>(
    null,
  );

  useEffect(() => {
    if (!ready || !user) {
      setHubRoute(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const [gates, systems] = await Promise.all([loadGates(), listSystems()]);
      if (!cancelled) {
        setHubRoute(
          initialHubRoute({
            gateCount: gates.length,
            systemCount: systems.length,
          }),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, user]);

  if (!ready) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: colors.background,
        }}
      >
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const signedOut = !user;
  const initialRoute: keyof RootStackParamList | null = signedOut
    ? 'SignIn'
    : hubRoute;

  if (!initialRoute) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: colors.background,
        }}
      >
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <NavigationContainer key={user?.uid ?? 'signed-out'} theme={navigationTheme}>
      <Stack.Navigator
        initialRouteName={initialRoute}
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.primary,
          headerTitleStyle: {
            color: colors.text,
            fontWeight: '600',
          },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen
          name="SignIn"
          component={SignInScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="GateSystems"
          component={GateSystemsScreen}
          options={{ title: 'Gate systems' }}
        />
        <Stack.Screen
          name="LinkAccount"
          component={LinkAccountScreen}
          options={{ title: 'Link PalGate' }}
        />
        <Stack.Screen
          name="ExportAccount"
          getComponent={() =>
            require('../ui/screens/ExportAccountScreen').ExportAccountScreen
          }
          options={{ title: 'Export' }}
        />
        <Stack.Screen
          name="Permissions"
          component={PermissionsScreen}
          options={{ title: 'Permissions' }}
        />
        <Stack.Screen
          name="GatesList"
          component={GatesListScreen}
          options={{ title: 'Gates' }}
        />
        <Stack.Screen
          name="GateEditor"
          getComponent={() =>
            require('../ui/screens/GateEditorScreen').GateEditorScreen
          }
          options={{ title: 'Gate' }}
        />
        <Stack.Screen
          name="ShareGate"
          getComponent={() =>
            require('../ui/screens/ShareGateScreen').ShareGateScreen
          }
          options={{ title: 'Share gate' }}
        />
        <Stack.Screen
          name="Monitoring"
          component={MonitoringScreen}
          options={{ title: 'Log' }}
        />
        <Stack.Screen
          name="Settings"
          getComponent={() =>
            require('../ui/screens/SettingsScreen').SettingsScreen
          }
          options={{ title: 'Settings' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
