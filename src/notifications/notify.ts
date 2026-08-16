import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

const CHANNEL_ID = 'gateauto';
const LINKING_CHANNEL_ID = 'gateauto-linking';
const MONITORING_CHANNEL_ID = 'gateauto-monitoring';

let channelReady: Promise<void> | null = null;
let linkingChannelReady: Promise<void> | null = null;
let monitoringChannelReady: Promise<void> | null = null;
let linkingNotificationId: string | null = null;
let monitoringNotificationId: string | null = null;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  if (!channelReady) {
    channelReady = Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'GateAuto',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250],
      lightColor: '#1B4D89',
    }).then(() => undefined);
  }
  await channelReady;
}

async function ensureLinkingChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  if (!linkingChannelReady) {
    linkingChannelReady = Notifications.setNotificationChannelAsync(
      LINKING_CHANNEL_ID,
      {
        name: 'GateAuto linking',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0],
        lightColor: '#1B4D89',
        lockscreenVisibility:
          Notifications.AndroidNotificationVisibility.PUBLIC,
      },
    ).then(() => undefined);
  }
  await linkingChannelReady;
}

async function ensureMonitoringChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  if (!monitoringChannelReady) {
    monitoringChannelReady = Notifications.setNotificationChannelAsync(
      MONITORING_CHANNEL_ID,
      {
        name: 'GateAuto auto-open',
        importance: Notifications.AndroidImportance.MIN,
        vibrationPattern: [0],
        lightColor: '#0D3D42',
        sound: undefined,
        enableVibrate: false,
        lockscreenVisibility:
          Notifications.AndroidNotificationVisibility.PUBLIC,
      },
    ).then(() => undefined);
  }
  await monitoringChannelReady;
}

export async function ensureNotificationSetup(): Promise<void> {
  await ensureAndroidChannel();
  await ensureLinkingChannel();
  await ensureMonitoringChannel();
}

function immediateTrigger(): Notifications.NotificationTriggerInput {
  return Platform.OS === 'android' ? { channelId: CHANNEL_ID } : null;
}

/** Sticky reminder while long-poll linking is active. */
export async function showLinkingStickyNotification(): Promise<void> {
  try {
    await ensureLinkingChannel();
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      await Notifications.requestPermissionsAsync();
    }
    if (linkingNotificationId) {
      await Notifications.dismissNotificationAsync(linkingNotificationId);
      linkingNotificationId = null;
    }
    linkingNotificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'GateAuto linking — keep this notification',
        body: 'Switch to PalGate on this phone, scan the QR, then return. Long-poll resumes automatically.',
        sticky: true,
        autoDismiss: false,
        priority: Notifications.AndroidNotificationPriority.HIGH,
        sound: false,
        ...(Platform.OS === 'android'
          ? { channelId: LINKING_CHANNEL_ID }
          : {}),
      },
      trigger: null,
    });
  } catch (error) {
    console.warn('[GateAuto] showLinkingStickyNotification failed', error);
  }
}

export async function clearLinkingStickyNotification(): Promise<void> {
  try {
    if (linkingNotificationId) {
      await Notifications.dismissNotificationAsync(linkingNotificationId);
      linkingNotificationId = null;
    }
    // Also clear any leftover linking notifications by presented list.
    const presented = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(
      presented
        .filter((n) =>
          String(n.request.content.title ?? '').includes('linking'),
        )
        .map((n) =>
          Notifications.dismissNotificationAsync(n.request.identifier),
        ),
    );
  } catch (error) {
    console.warn('[GateAuto] clearLinkingStickyNotification failed', error);
  }
}

/**
 * Previously showed a sticky “armed (geofence)” status. Play Services geofences
 * do not need a persistent notification — default is OFF (no sticky). Kept as
 * a dismiss helper so upgrades / old builds clear leftovers.
 */
export async function showMonitoringStickyNotification(): Promise<void> {
  await clearMonitoringStickyNotification();
}

/** Dismiss any leftover armed / monitoring sticky (including from older builds). */
export async function clearMonitoringStickyNotification(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    if (monitoringNotificationId) {
      await Notifications.dismissNotificationAsync(monitoringNotificationId);
      monitoringNotificationId = null;
    }
    const presented = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(
      presented
        .filter((n) => {
          const title = String(n.request.content.title ?? '');
          const body = String(n.request.content.body ?? '');
          const channelId = String(
            (n.request.content as { channelId?: string }).channelId ?? '',
          );
          return (
            title.includes('armed (geofence)') ||
            title.includes('watching gates') ||
            body.includes('Low-battery mode') ||
            body.includes('Low battery mode') ||
            channelId === MONITORING_CHANNEL_ID
          );
        })
        .map((n) =>
          Notifications.dismissNotificationAsync(n.request.identifier),
        ),
    );
  } catch (error) {
    console.warn('[GateAuto] clearMonitoringStickyNotification failed', error);
  }
}

async function ensureNotifyPermission(): Promise<boolean> {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    const requested = await Notifications.requestPermissionsAsync();
    return requested.granted;
  } catch {
    return false;
  }
}

export async function notifyOpenSuccess(gateName: string): Promise<void> {
  try {
    await ensureAndroidChannel();
    await ensureNotifyPermission();
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Gate opened',
        body: gateName,
        sound: true,
        priority: Notifications.AndroidNotificationPriority.HIGH,
      },
      trigger: immediateTrigger(),
    });
  } catch (error) {
    console.warn('[GateAuto] notifyOpenSuccess failed', error);
  }
}

export async function notifyOpenFailure(
  gateName: string,
  message: string,
): Promise<void> {
  try {
    await ensureAndroidChannel();
    await ensureNotifyPermission();
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `Gate open failed: ${gateName}`,
        body: message,
        sound: true,
        priority: Notifications.AndroidNotificationPriority.HIGH,
      },
      trigger: immediateTrigger(),
    });
  } catch (error) {
    console.warn('[GateAuto] notifyOpenFailure failed', error);
  }
}
