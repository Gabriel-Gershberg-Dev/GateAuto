import { AppRegistry, DeviceEventEmitter } from 'react-native';
import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import {
  GEOFENCE_TASK_NAME,
  LOCATION_WATCH_TASK_NAME,
  handleGeofenceEnter,
  handleGeofenceExit,
  handleBluetoothDeviceConnected,
  runEligibilityPoll,
  ensureMonitoringHelpers,
} from './geofencing';
import { resyncMonitoringIfArmed } from './monitoringResync';
import { hydrateUserScope } from '../data/userScope';
import { LINKING_WATCH_TASK_NAME } from './linkingKeepAlive';
import { MONITORING_KEEPALIVE_TASK_NAME } from './monitoringKeepAlive';

/** Native BootSyncService headless task name (see withAndroidBootSync). */
export const BOOT_SYNC_TASK_NAME = 'GateAutoBootSync';

type GeofenceTaskData = {
  eventType: Location.LocationGeofencingEventType;
  region: Location.LocationRegion;
};

/**
 * Must be imported early at app bootstrap (see App.tsx / index.ts).
 * TaskManager.defineTask is a side effect of loading this module.
 */
TaskManager.defineTask<GeofenceTaskData>(
  GEOFENCE_TASK_NAME,
  async ({ data, error }) => {
    if (error) {
      console.error('[GateAuto] GEOFENCE_TASK error', error.message);
      return;
    }
    if (!data) return;

    const { eventType, region } = data;
    const identifier = region?.identifier;
    if (!identifier) {
      console.warn('[GateAuto] geofence event without region identifier');
      return;
    }

    if (eventType === Location.GeofencingEventType.Enter) {
      try {
        await handleGeofenceEnter(identifier);
      } catch (err) {
        console.error('[GateAuto] handleGeofenceEnter failed', err);
      }
      return;
    }

    if (eventType === Location.GeofencingEventType.Exit) {
      try {
        await handleGeofenceExit(identifier);
      } catch (err) {
        console.error('[GateAuto] handleGeofenceExit failed', err);
      }
    }
  },
);

/**
 * Legacy monitoring location-watch task. No longer started; handler kept so
 * orphaned registrations from older APKs do not crash on update delivery.
 */
TaskManager.defineTask(LOCATION_WATCH_TASK_NAME, async ({ error }) => {
  if (error) {
    console.error('[GateAuto] LOCATION_WATCH_TASK error', error.message);
  }
});

/**
 * Linking-only Android FGS. No open pipeline — keeps process alive for long-poll
 * while the user switches to PalGate on the same phone.
 */
TaskManager.defineTask(LINKING_WATCH_TASK_NAME, async ({ error }) => {
  if (error) {
    console.error('[GateAuto] LINKING_WATCH_TASK error', error.message);
  }
});

/**
 * Silent monitoring keep-alive FGS. Lowest-accuracy wakes only — each wake
 * runs a one-shot high-accuracy eligibility poll (already-inside + BT connected).
 */
TaskManager.defineTask(MONITORING_KEEPALIVE_TASK_NAME, async ({ error }) => {
  if (error) {
    console.error('[GateAuto] MONITORING_KEEPALIVE_TASK error', error.message);
    return;
  }
  try {
    await runEligibilityPoll();
  } catch (err) {
    console.error('[GateAuto] eligibility poll failed', err);
  }
});

async function runBootSync(): Promise<void> {
  try {
    await hydrateUserScope();
    console.log(
      '[GateAuto] boot sync — re-registering geofences + BT/FGS if armed',
    );
    await resyncMonitoringIfArmed('boot');
  } catch (error) {
    console.warn('[GateAuto] boot sync failed', error);
  }
}

AppRegistry.registerHeadlessTask(BOOT_SYNC_TASK_NAME, () => runBootSync);
AppRegistry.registerHeadlessTask('GateAutoKeepAliveSync', () => runKeepAliveSync);

DeviceEventEmitter.addListener('GateAutoKeepAlivePoll', () => {
  void runEligibilityPoll().catch((err) => {
    console.error('[GateAuto] native search poll failed', err);
  });
});

async function runKeepAliveSync(data?: {
  reason?: string;
  identifier?: string;
  name?: string;
  address?: string;
}): Promise<void> {
  const reason = data?.reason ?? 'poll';
  try {
    if ((reason === 'enter' || reason === 'exit') && data?.identifier) {
      if (reason === 'exit') {
        await handleGeofenceExit(data.identifier);
      } else {
        await handleGeofenceEnter(data.identifier);
      }
      return;
    }
    if (reason === 'bt') {
      const name = (data?.name || data?.address || 'Bluetooth').trim();
      await handleBluetoothDeviceConnected({
        name,
        address: data?.address,
        id: data?.address,
      });
      return;
    }
    console.log('[GateAuto] keep-alive poll — helpers + eligibility', reason);
    await ensureMonitoringHelpers();
    await runEligibilityPoll({ force: reason === 'cooldown' });
  } catch (error) {
    console.warn('[GateAuto] keep-alive sync failed', error);
  }
}

export {
  GEOFENCE_TASK_NAME,
  LOCATION_WATCH_TASK_NAME,
  LINKING_WATCH_TASK_NAME,
  MONITORING_KEEPALIVE_TASK_NAME,
};
