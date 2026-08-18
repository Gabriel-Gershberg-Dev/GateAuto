/**
 * Re-register OS geofences when the JS runtime wakes (cold start, AppState,
 * headless boot task). Safe to call repeatedly — syncGeofences is idempotent.
 */

import { AppState, type AppStateStatus } from 'react-native';
import { appendEvent } from '../data/eventLog';
import {
  isMonitoringEnabled,
  setMonitoringEnabled,
} from '../data/gatesStore';
import { getNativeKeepAliveArmed, importNativeOpenEvents } from '../platform/keepAliveAlarm';
import { clearMonitoringStickyNotification } from '../notifications/notify';
import {
  checkEligibleNowAndOpen,
  getMonitoringArmStatus,
  startMonitoring,
  stopMonitoring,
  syncGeofences,
} from './geofencing';

let started = false;
let syncing: Promise<void> | null = null;
let lastForegroundStatusLogAt = 0;
const FOREGROUND_STATUS_LOG_MIN_MS = 120_000;

export async function resyncMonitoringIfArmed(reason: string): Promise<void> {
  if (syncing) {
    await syncing;
    return;
  }

  syncing = (async () => {
    try {
      await importNativeOpenEvents();
      // Upgrade path: always drop any leftover armed sticky from older builds.
      await clearMonitoringStickyNotification();
      const nativeArmed = await getNativeKeepAliveArmed();
      const jsArmed = await isMonitoringEnabled();
      if (nativeArmed !== null && nativeArmed !== jsArmed) {
        await setMonitoringEnabled(nativeArmed);
        if (!nativeArmed) {
          await stopMonitoring();
          return;
        }
        await startMonitoring();
        return;
      }
      const armed = nativeArmed ?? jsArmed;
      if (!armed) return;
      console.log(`[GateAuto] resync geofences (${reason})`);
      await syncGeofences();

      // Cold start: write a visible status so Monitoring isn't a black box.
      // Foreground returns: throttle so we don't flood the log.
      const now = Date.now();
      const shouldLog =
        reason === 'app-start' ||
        now - lastForegroundStatusLogAt >= FOREGROUND_STATUS_LOG_MIN_MS;
      if (shouldLog) {
        lastForegroundStatusLogAt = now;
        const status = await getMonitoringArmStatus();
        await appendEvent({
          kind: 'info',
          message: `Resync (${reason}): flag ON, ${status.geofenceCount} geofence(s), OS geo ${status.geofencingActive ? 'ON' : 'OFF'}, BT watch ${status.btWatchOn ? 'ON' : 'OFF'}, FGS ${status.keepAliveOn ? 'ON' : 'OFF'}. Already inside? ENTER will not re-fire — running eligible-now.`,
        });
      }

      // Already inside + BT already connected: no ENTER/ACL → open if eligible.
      await checkEligibleNowAndOpen(reason);
    } catch (error) {
      console.warn(`[GateAuto] resync geofences failed (${reason})`, error);
      const message = error instanceof Error ? error.message : String(error);
      await appendEvent({
        kind: 'error',
        message: `Resync failed (${reason}): ${message}`,
      });
    } finally {
      syncing = null;
    }
  })();

  await syncing;
}

/**
 * Call once from App bootstrap. Handles cold start + foreground returns.
 * BootReceiver headless task also calls resyncMonitoringIfArmed('boot').
 */
export function startMonitoringResyncLifecycle(): void {
  if (started) return;
  started = true;

  void resyncMonitoringIfArmed('app-start');

  AppState.addEventListener('change', (next: AppStateStatus) => {
    if (next === 'active') {
      void resyncMonitoringIfArmed('appstate-active');
    }
  });
}
