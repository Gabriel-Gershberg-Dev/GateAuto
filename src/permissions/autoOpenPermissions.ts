/**
 * Probe / request the Auto-open critical set.
 * Not prompted: overlay, exact alarm, REQUEST_INSTALL_PACKAGES (update flow).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';
import { hasBluetoothPermissions, requestBluetoothPermissions } from '../bluetooth/carBluetooth';
import { hydrateUserScope, scopedAsyncKey } from '../data/userScope';
import {
  getAutoOpenOsStatus,
  isBatteryUnrestricted,
} from '../platform/keepAliveAlarm';
import {
  openAppDetailsSettings,
  openBatteryUnrestrictedPrompt,
} from '../platform/androidBatteryLinks';
import {
  EMPTY_ONBOARDING,
  missingCritical,
  parseOnboardingState,
  persistAfterPermissionDecision,
  shouldShowPermissionSheet,
  type CriticalPermissionId,
  type OnboardingPersisted,
  type PermissionProbe,
} from './onboardingLogic';
import { bluetoothPermissionGranted, batteryUnrestrictedGranted } from './permissionStatusLogic';

export type {
  CriticalPermissionId,
  OnboardingPersisted,
  PermissionProbe,
} from './onboardingLogic';
export { missingCritical, shouldShowPermissionSheet } from './onboardingLogic';

type StatusListener = (missing: CriticalPermissionId[]) => void;

const statusListeners = new Set<StatusListener>();
const openSheetListeners = new Set<() => void>();

let lastMissing: CriticalPermissionId[] = [];

function setupKey(): string {
  return scopedAsyncKey('permSetup.v1');
}

export function getLastMissingPermissions(): CriticalPermissionId[] {
  return lastMissing;
}

export function subscribePermissionStatus(listener: StatusListener): () => void {
  statusListeners.add(listener);
  listener(lastMissing);
  return () => {
    statusListeners.delete(listener);
  };
}

/** Gates banner tap — re-open the setup sheet even if they already skipped. */
export function requestOpenPermissionSetup(): void {
  for (const listener of openSheetListeners) listener();
}

export function subscribeOpenPermissionSetup(listener: () => void): () => void {
  openSheetListeners.add(listener);
  return () => {
    openSheetListeners.delete(listener);
  };
}

function emitStatus(missing: CriticalPermissionId[]): void {
  lastMissing = missing;
  for (const listener of statusListeners) listener(missing);
}

export async function loadOnboardingState(): Promise<OnboardingPersisted> {
  await hydrateUserScope();
  try {
    const raw = await AsyncStorage.getItem(setupKey());
    if (!raw) return { ...EMPTY_ONBOARDING };
    return parseOnboardingState(JSON.parse(raw) as unknown);
  } catch {
    return { ...EMPTY_ONBOARDING };
  }
}

export async function saveOnboardingState(
  state: OnboardingPersisted,
): Promise<void> {
  await hydrateUserScope();
  await AsyncStorage.setItem(setupKey(), JSON.stringify(state));
}

export async function probeAutoOpenPermissions(): Promise<PermissionProbe> {
  const [foreground, background, notif, os] = await Promise.all([
    Location.getForegroundPermissionsAsync(),
    Location.getBackgroundPermissionsAsync(),
    Notifications.getPermissionsAsync(),
    getAutoOpenOsStatus(),
  ]);
  const bluetooth = os
    ? bluetoothPermissionGranted({
        sdkInt: os.sdkInt,
        connectGranted: os.bluetoothConnectGranted,
        adapterEnabled: os.bluetoothAdapterEnabled,
      })
    : await hasBluetoothPermissions();
  const battery =
    Platform.OS !== 'android'
      ? true
      : os
        ? batteryUnrestrictedGranted({
            ignoringBatteryOptimizations: os.ignoringBatteryOptimizations,
            backgroundRestricted: os.backgroundRestricted,
            powerRestrictionExempt: os.powerRestrictionExempt,
            samsungNeverSleeping: os.samsungNeverSleeping,
            standbyExempt: os.standbyExempt,
          })
        : (await isBatteryUnrestricted()) === true;
  return {
    locationFg: Boolean(foreground.granted),
    locationBg: Boolean(background.granted),
    notifications: Boolean(notif.granted),
    bluetooth,
    batteryUnrestricted: battery,
  };
}

async function requestLocationAlways(): Promise<void> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) return;
  const bg = await Location.requestBackgroundPermissionsAsync();
  if (!bg.granted && bg.canAskAgain === false) {
    await openAppDetailsSettings();
  }
}

export async function requestCriticalPermission(
  id: CriticalPermissionId,
): Promise<void> {
  if (id === 'notifications') {
    await Notifications.requestPermissionsAsync();
    return;
  }
  if (id === 'location') {
    await requestLocationAlways();
    return;
  }
  if (id === 'bluetooth') {
    const ok = await requestBluetoothPermissions();
    if (!ok && Platform.OS === 'android') {
      await openAppDetailsSettings();
    }
    return;
  }
  if (id === 'battery') {
    await openBatteryUnrestrictedPrompt();
  }
}

export async function requestAllMissing(
  missing: CriticalPermissionId[],
): Promise<void> {
  if (missing.includes('notifications')) {
    await requestCriticalPermission('notifications');
  }
  if (missing.includes('location')) {
    await requestCriticalPermission('location');
  }
  if (missing.includes('bluetooth')) {
    await requestCriticalPermission('bluetooth');
  }
  if (missing.includes('battery')) {
    await requestCriticalPermission('battery');
  }
}

export async function refreshPermissionStatus(): Promise<CriticalPermissionId[]> {
  const probe = await probeAutoOpenPermissions();
  const missing = missingCritical(probe);
  // Transition from "something missing" → "all granted": the auto-open critical
  // set was just completed (e.g. background location finally granted).
  const becameComplete = missing.length === 0 && lastMissing.length > 0;
  emitStatus(missing);
  void import('../telemetry/bootstrap')
    .then((m) => m.reportPermissionState())
    .catch(() => undefined);
  if (missing.length === 0) {
    const prev = await loadOnboardingState();
    await saveOnboardingState(
      persistAfterPermissionDecision({
        prev,
        missingCount: 0,
        didShowSheet: false,
        dismissedLater: false,
      }),
    );
    if (becameComplete) {
      // Re-register geofences + re-ensure keep-alive services now that the
      // permissions are complete, so a gate whose Play fence failed to register
      // before background location was granted (a gate silently falling out of
      // the armed set) is re-armed immediately — not only on the next AppState
      // 'active' cycle. resyncMonitoringIfArmed no-ops when not armed.
      void import('../geo/monitoringResync')
        .then((m) => m.resyncMonitoringIfArmed('permission-granted'))
        .catch(() => undefined);
    }
  }
  return missing;
}

export async function decidePermissionSheet(input: {
  signedIn: boolean;
  force?: boolean;
}): Promise<{
  missing: CriticalPermissionId[];
  showSheet: boolean;
  state: OnboardingPersisted;
}> {
  const [state, missing] = await Promise.all([
    loadOnboardingState(),
    refreshPermissionStatus(),
  ]);
  const showSheet = shouldShowPermissionSheet({
    signedIn: input.signedIn,
    missingCount: missing.length,
    state,
    force: Boolean(input.force),
  });
  // First-run sheet is not marked handled until Later / all granted.
  // After a later revoke, mark the one extra sheet so cold start does not spam.
  if (
    showSheet &&
    state.lastAllGranted &&
    !state.revokedSheetShown &&
    missing.length > 0
  ) {
    await saveOnboardingState(
      persistAfterPermissionDecision({
        prev: state,
        missingCount: missing.length,
        didShowSheet: true,
        dismissedLater: false,
      }),
    );
  }
  return { missing, showSheet, state };
}

export async function markPermissionSetupLater(): Promise<void> {
  const prev = await loadOnboardingState();
  await saveOnboardingState(
    persistAfterPermissionDecision({
      prev,
      missingCount: Math.max(1, lastMissing.length),
      didShowSheet: true,
      dismissedLater: true,
    }),
  );
}

/** Re-probe when returning from system settings. */
export function startPermissionAppStateRefresh(): () => void {
  const sub = AppState.addEventListener('change', (next) => {
    if (next === 'active') void refreshPermissionStatus();
  });
  return () => sub.remove();
}
