import { StatusBar } from 'expo-status-bar';
import {
  SafeAreaProvider,
  initialWindowMetrics,
} from 'react-native-safe-area-context';
// Register GEOFENCE / boot headless tasks early (TaskManager + AppRegistry).
import './src/geo/task';
import { startMonitoringResyncLifecycle } from './src/geo/monitoringResync';
import { AuthProvider } from './src/auth/AuthProvider';
import { RootNavigator } from './src/navigation/RootNavigator';
import { GlobalOpenResultHost } from './src/ui/components/GlobalOpenResultHost';
import { ThemeProvider, useTheme } from './src/ui/ThemeProvider';

startMonitoringResyncLifecycle();

function AppStatusBar() {
  const { scheme } = useTheme();
  return <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />;
}

export default function App() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <ThemeProvider>
        <AuthProvider>
          <RootNavigator />
          <GlobalOpenResultHost />
          <AppStatusBar />
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
