/**
 * Android foreground-service keep-alive used only while PalGate Linked Device
 * long-poll is active. Separate from monitoring (which is geofences-only and
 * must not start a continuous location FGS).
 */

import { Platform } from 'react-native';
import * as Location from 'expo-location';
import { ensureNotificationSetup } from '../notifications/notify';

/** Dedicated TaskManager name — do not reuse GATEAUTO_LOCATION_WATCH_TASK. */
export const LINKING_WATCH_TASK_NAME = 'GATEAUTO_LINKING_WATCH_TASK';

async function ensureLinkingLocationPermissions(): Promise<boolean> {
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
 * Start a short-interval Android location FGS so GateAuto survives switching to
 * PalGate on the same phone during QR scan / long-poll.
 * @returns true if FGS is running (or already was).
 */
export async function startLinkingForegroundWatch(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;

  try {
    const permitted = await ensureLinkingLocationPermissions();
    if (!permitted) {
      console.warn('[GateAuto:link] linking FGS skipped — location denied');
      return false;
    }

    const already = await Location.hasStartedLocationUpdatesAsync(
      LINKING_WATCH_TASK_NAME,
    );
    if (already) return true;

    await Location.startLocationUpdatesAsync(LINKING_WATCH_TASK_NAME, {
      accuracy: Location.Accuracy.Lowest,
      distanceInterval: 1000,
      timeInterval: 15_000,
      deferredUpdatesInterval: 15_000,
      showsBackgroundLocationIndicator: false,
      foregroundService: {
        notificationTitle: 'GateAuto linking — switch to PalGate to scan',
        notificationBody:
          'Keep this notification; long-poll stays alive. Return after scanning.',
        notificationColor: '#1B4D89',
        killServiceOnDestroy: false,
      },
    });
    console.log('[GateAuto:link] linking FGS started');
    return true;
  } catch (error) {
    console.warn('[GateAuto:link] linking FGS start failed', error);
    return false;
  }
}

export async function stopLinkingForegroundWatch(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    if (await Location.hasStartedLocationUpdatesAsync(LINKING_WATCH_TASK_NAME)) {
      await Location.stopLocationUpdatesAsync(LINKING_WATCH_TASK_NAME);
      console.log('[GateAuto:link] linking FGS stopped');
    }
  } catch (error) {
    console.warn('[GateAuto:link] linking FGS stop failed', error);
  }
}
