/**
 * Legacy Expo location FGS. Native HoldService + MonitoringService own
 * persistence now. This module only stops leftovers so the status-bar GPS
 * pill can drop when every auto-on gate is waiting for a listed car.
 */

import { Platform } from 'react-native';
import * as Location from 'expo-location';

/** Dedicated TaskManager name — do not reuse linking or legacy watch tasks. */
export const MONITORING_KEEPALIVE_TASK_NAME = 'GATEAUTO_MONITORING_KEEPALIVE_TASK';

/**
 * Former Expo wake interval. Native MonitoringService uses its own 30s far
 * / 1 Hz near stream when location is actually demanded.
 */
export const MONITORING_POLL_WAKE_INTERVAL_MS = 30_000;

/** Drop leftover Expo location updates. Always no-op start. */
export async function startMonitoringKeepAlive(): Promise<boolean> {
  await stopMonitoringKeepAlive();
  return false;
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
