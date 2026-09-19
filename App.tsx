import { StatusBar } from 'expo-status-bar';
import {
  SafeAreaProvider,
  initialWindowMetrics,
} from 'react-native-safe-area-context';
// Register GEOFENCE / boot headless tasks early (TaskManager + AppRegistry).
import './src/geo/task';
import { startMonitoringResyncLifecycle } from './src/geo/monitoringResync';
import { startTelemetryBootstrap } from './src/telemetry/bootstrap';
import { hydrateSafetyLockSettingsToNative } from './src/data/safetyLockSettings';
import { hydrateUserScope } from './src/data/userScope';
import { AuthProvider } from './src/auth/AuthProvider';
import { I18nProvider } from './src/i18n/I18nProvider';
import { RootNavigator } from './src/navigation/RootNavigator';
import { AppUpdateHost } from './src/ui/components/AppUpdateHost';
import { GlobalOpenResultHost } from './src/ui/components/GlobalOpenResultHost';
import { ThemeProvider, useTheme } from './src/ui/ThemeProvider';

void hydrateUserScope().then(() => {
  startMonitoringResyncLifecycle();
  void hydrateSafetyLockSettingsToNative();
  startTelemetryBootstrap();
});

function AppStatusBar() {
  const { scheme } = useTheme();
  return <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />;
}

export default function App() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <ThemeProvider>
        <I18nProvider>
          <AuthProvider>
            <RootNavigator />
            <AppUpdateHost />
            <GlobalOpenResultHost />
            <AppStatusBar />
          </AuthProvider>
        </I18nProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
