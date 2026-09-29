import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthProvider';
import { useAppI18n } from '../i18n/I18nProvider';
import { loadGates } from '../data/gatesStore';
import { listSystems } from '../data/palgateSystems';
import { initialHubRoute } from '../data/vaultRecoverLogic';
import {
  clearResumeRoute,
  consumeResumeRoute,
  shouldResumeSettings,
} from './resumeRoute';
import { refreshAppConnection } from '../firebase/refreshConnection';
import {
  createStartupGate,
  recoverStartupRead,
  StartupAttemptCancelled,
  StartupContinued,
  startupNetworkWaived,
  waiveStartupNetwork,
  type StartupGate,
  type StartupNetPhase,
} from '../firebase/startupNetwork';
import { listIncomingPendingInvites } from '../share/invites';
import { StartupScreen } from '../ui/components/StartupScreen';
import { PermissionSetupHost } from '../ui/components/PermissionSetupHost';
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
  Notifications: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { t } = useTranslation();
  const { isRtl } = useAppI18n();
  const { colors, navigationTheme } = useTheme();
  const {
    user,
    ready,
    startupConnection,
    retryStartupConnection,
    continueStartup,
  } = useAuth();
  const [hubRoute, setHubRoute] = useState<'GateSystems' | 'GatesList' | null>(
    null,
  );
  const [resumeSettings, setResumeSettings] = useState(false);
  const [hubConnection, setHubConnection] = useState<StartupNetPhase>('quiet');
  const hubGateRef = useRef<StartupGate | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      setHubRoute(null);
      setResumeSettings(false);
      setHubConnection('quiet');
      void clearResumeRoute();
      return;
    }
    let cancelled = false;
    const gate = createStartupGate();
    hubGateRef.current = gate;
    setHubConnection('quiet');
    (async () => {
      const local = Promise.all([
        loadGates(),
        listSystems(),
        consumeResumeRoute(),
      ]);
      let pending: Awaited<ReturnType<typeof listIncomingPendingInvites>> = [];
      if (!startupNetworkWaived()) {
        try {
          pending = await recoverStartupRead({
            read: () => listIncomingPendingInvites().catch(() => []),
            refresh: refreshAppConnection,
            isStopped: gate.isStopped,
            wait: gate.wait,
            onPhase: (phase) => {
              if (!cancelled) setHubConnection(phase);
            },
          });
        } catch (error) {
          if (cancelled || error instanceof StartupAttemptCancelled) return;
          if (!(error instanceof StartupContinued)) return;
          pending = [];
        }
      }
      const [gates, systems, resume] = await local;
      if (cancelled) return;
      setHubConnection('quiet');
      setResumeSettings(shouldResumeSettings(true, resume));
      setHubRoute(
        initialHubRoute({
          gateCount: gates.length,
          systemCount: systems.length,
          pendingInviteCount: pending.length,
        }),
      );
    })();
    return () => {
      cancelled = true;
      gate.cancel();
      if (hubGateRef.current === gate) hubGateRef.current = null;
    };
  }, [ready, user]);

  const signedOut = !user;
  const initialRoute: keyof RootStackParamList | null = !ready
    ? null
    : signedOut
      ? 'SignIn'
      : hubRoute;

  if (!initialRoute) {
    const connection = !ready ? startupConnection : hubConnection;
    return (
      <StartupScreen
        connection={connection}
        onRefresh={() => {
          if (!ready) retryStartupConnection();
          else hubGateRef.current?.kick();
        }}
        onContinue={() => {
          if (!ready) continueStartup();
          else {
            waiveStartupNetwork();
            hubGateRef.current?.continue();
          }
        }}
      />
    );
  }

  return (
    <>
      <NavigationContainer
        key={user?.uid ?? 'signed-out'}
        theme={navigationTheme}
        direction={isRtl ? 'rtl' : 'ltr'}
        initialState={
          shouldResumeSettings(Boolean(user), resumeSettings ? 'Settings' : null) &&
          hubRoute
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
        <Stack.Screen
          name="Notifications"
          getComponent={() =>
            require('../ui/screens/NotificationsScreen').NotificationsScreen
          }
          options={{ title: t('nav.notifications') }}
        />
      </Stack.Navigator>
    </NavigationContainer>
      {user ? <PermissionSetupHost /> : null}
    </>
  );
}
