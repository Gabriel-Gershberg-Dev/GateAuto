import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { hasCredentials } from '../data/credentials';
import { useTheme } from '../ui/ThemeProvider';
import { GatesListScreen } from '../ui/screens/GatesListScreen';
import { LinkAccountScreen } from '../ui/screens/LinkAccountScreen';
import { MonitoringScreen } from '../ui/screens/MonitoringScreen';
import { PermissionsScreen } from '../ui/screens/PermissionsScreen';

export type RootStackParamList = {
  LinkAccount: undefined;
  ExportAccount: { continueTo?: 'Permissions' } | undefined;
  Permissions: undefined;
  GatesList: undefined;
  GateEditor: { gateId: string };
  Monitoring: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { colors, navigationTheme } = useTheme();
  const [initialRoute, setInitialRoute] = useState<
    keyof RootStackParamList | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const linked = await hasCredentials();
      if (!cancelled) {
        setInitialRoute(linked ? 'GatesList' : 'LinkAccount');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
    <NavigationContainer theme={navigationTheme}>
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
