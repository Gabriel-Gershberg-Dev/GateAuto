import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthProvider';
import { useAppI18n } from '../i18n/I18nProvider';
import { loadGates } from '../data/gatesStore';
import { listSystems } from '../data/palgateSystems';
import { initialHubRoute } from '../data/vaultRecoverLogic';
import { consumeResumeRoute } from './resumeRoute';
import { listIncomingPendingInvites } from '../share/invites';
import { StartupScreen } from '../ui/components/StartupScreen';
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
  const { t } = useTranslation();
  const { isRtl } = useAppI18n();
  const { colors, navigationTheme } = useTheme();
  const { user, ready } = useAuth();
  const [hubRoute, setHubRoute] = useState<'GateSystems' | 'GatesList' | null>(
    null,
  );
  const [resumeSettings, setResumeSettings] = useState(false);

  useEffect(() => {
    if (!ready || !user) {
      setHubRoute(null);
      setResumeSettings(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const [gates, systems, resume, pending] = await Promise.all([
        loadGates(),
        listSystems(),
        consumeResumeRoute(),
        listIncomingPendingInvites().catch(() => []),
      ]);
      if (!cancelled) {
        setResumeSettings(resume === 'Settings');
        setHubRoute(
          initialHubRoute({
            gateCount: gates.length,
            systemCount: systems.length,
            pendingInviteCount: pending.length,
          }),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, user]);

  const signedOut = !user;
  const initialRoute: keyof RootStackParamList | null = !ready
    ? null
    : signedOut
      ? 'SignIn'
      : hubRoute;

  if (!initialRoute) {
    return <StartupScreen />;
  }

  return (
    <NavigationContainer
      key={user?.uid ?? 'signed-out'}
      theme={navigationTheme}
      direction={isRtl ? 'rtl' : 'ltr'}
      initialState={
        resumeSettings && hubRoute
          ? {
              index: 1,
              routes: [{ name: hubRoute }, { name: 'Settings' }],
            }
          : undefined
      }
    >
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
          options={{ title: t('nav.gateSystems') }}
        />
        <Stack.Screen
          name="LinkAccount"
          component={LinkAccountScreen}
          options={{ title: t('nav.linkPalGate') }}
        />
        <Stack.Screen
          name="ExportAccount"
          getComponent={() =>
            require('../ui/screens/ExportAccountScreen').ExportAccountScreen
          }
          options={{ title: t('nav.export') }}
        />
        <Stack.Screen
          name="Permissions"
          component={PermissionsScreen}
          options={{ title: t('nav.permissions') }}
        />
        <Stack.Screen
          name="GatesList"
          component={GatesListScreen}
          options={{ title: t('nav.gates') }}
        />
        <Stack.Screen
          name="GateEditor"
          getComponent={() =>
            require('../ui/screens/GateEditorScreen').GateEditorScreen
          }
          options={{ title: t('nav.gate') }}
        />
        <Stack.Screen
          name="ShareGate"
          getComponent={() =>
            require('../ui/screens/ShareGateScreen').ShareGateScreen
          }
          options={{ title: t('nav.shareGate') }}
        />
        <Stack.Screen
          name="Monitoring"
          component={MonitoringScreen}
          options={{ title: t('nav.log') }}
        />
        <Stack.Screen
          name="Settings"
          getComponent={() =>
            require('../ui/screens/SettingsScreen').SettingsScreen
          }
          options={{ title: t('nav.settings') }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
