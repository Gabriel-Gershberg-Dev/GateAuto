/**
 * Silent Android foreground keep-alive while monitoring is ON.
 * Time-based wakes (~30s) so the process stays eligible for geofence delivery
 * + BT receivers, and JS can run a one-shot high-accuracy eligibility poll.
 * Notification is min-importance / quiet.
 *
 * Samsung/Doze often ignore Lowest+large distanceInterval and batch to
 * multi-minute wakes — use Balanced + distanceInterval 0 so timeInterval
 * is actually honored while stationary at home.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as Location from 'expo-location';
import { ensureNotificationSetup } from '../notifications/notify';

/** Dedicated TaskManager name — do not reuse linking or legacy watch tasks. */
export const MONITORING_KEEPALIVE_TASK_NAME = 'GATEAUTO_MONITORING_KEEPALIVE_TASK';

/**
 * Keep-alive wake interval. Task handler runs a one-shot high-accuracy
 * eligibility poll; this stream itself is not used for open distance.
 * Target ~30–45s so a 10s gate cooldown can be honored soon after expiry
 * (OS may still jitter slightly).
 */
export const MONITORING_POLL_WAKE_INTERVAL_MS = 15_000;

/** Bump when keep-alive timing/options change so armed installs re-apply once. */
const KEEPALIVE_CONFIG_VERSION = 'cooldown-wake-v6';
const KEEPALIVE_CONFIG_KEY = 'gateauto.keepaliveConfigVersion';

async function ensureKeepAlivePermissions(): Promise<boolean> {
  await ensureNotificationSetup();

  const foreground = await Location.getForegroundPermissionsAsync();
  let granted = foreground.granted;
  if (!granted) {
    const req = await Location.requestForegroundPermissionsAsync();
    granted = req.granted;
  }
  if (!granted) return false;

  if (Platform.OS === 'android') {
    const background = await Location.getBackgroundPermissionsAsync();
    if (!background.granted) {
      await Location.requestBackgroundPermissionsAsync();
    }
  }
  return true;
}

/**
 * Start quiet FGS while monitoring is armed.
 * Re-applies config once after APK upgrade (e.g. Lowest/5km/50s → Balanced/0m/30s);
 * does not bounce FGS on every foreground resync.
 * @returns true if keep-alive is running.
 */
export async function startMonitoringKeepAlive(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;

  try {
    const permitted = await ensureKeepAlivePermissions();
    if (!permitted) {
      console.warn('[GateAuto] monitoring keep-alive skipped — location denied');
      return false;
    }

    const already = await Location.hasStartedLocationUpdatesAsync(
      MONITORING_KEEPALIVE_TASK_NAME,
    );
    let configVersion: string | null = null;
    try {
      configVersion = await AsyncStorage.getItem(KEEPALIVE_CONFIG_KEY);
    } catch {
      configVersion = null;
    }
    const configCurrent = configVersion === KEEPALIVE_CONFIG_VERSION;

    if (already && configCurrent) {
      return true;
    }
    if (already) {
      await Location.stopLocationUpdatesAsync(MONITORING_KEEPALIVE_TASK_NAME);
    }

    await Location.startLocationUpdatesAsync(MONITORING_KEEPALIVE_TASK_NAME, {
      // High + 15s: Samsung batches Balanced to ~2 min while stationary (FGS).
      accuracy: Location.Accuracy.High,
      // 0 = do not require movement; honor timeInterval at home.
      distanceInterval: 0,
      timeInterval: MONITORING_POLL_WAKE_INTERVAL_MS,
      deferredUpdatesInterval: MONITORING_POLL_WAKE_INTERVAL_MS,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: false,
      foregroundService: {
        notificationTitle: 'GateAuto',
        notificationBody: 'Searching for nearby gates',
        notificationColor: '#0D3D42',
        killServiceOnDestroy: false,
      },
    });
    try {
      await AsyncStorage.setItem(KEEPALIVE_CONFIG_KEY, KEEPALIVE_CONFIG_VERSION);
    } catch {
      // ignore
    }
    console.log(
      `[GateAuto] monitoring keep-alive FGS started (poll wake ~${MONITORING_POLL_WAKE_INTERVAL_MS / 1000}s, Balanced, distanceInterval 0)`,
    );
    return true;
  } catch (error) {
    console.warn('[GateAuto] monitoring keep-alive start failed', error);
    return false;
  }
}

export async function stopMonitoringKeepAlive(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    if (
      await Location.hasStartedLocationUpdatesAsync(MONITORING_KEEPALIVE_TASK_NAME)
    ) {
      await Location.stopLocationUpdatesAsync(MONITORING_KEEPALIVE_TASK_NAME);
      console.log('[GateAuto] monitoring keep-alive FGS stopped');
    }
  } catch (error) {
    console.warn('[GateAuto] monitoring keep-alive stop failed', error);
  }
}
