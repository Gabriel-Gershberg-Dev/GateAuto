import AsyncStorage from '@react-native-async-storage/async-storage';
import { showUpdateAvailableNotification } from '../notifications/notify';
import { getNativeNotificationPrefs } from '../platform/keepAliveAlarm';
import { shouldPostUpdateNotice } from './updateNoticeLogic';

export { shouldPostUpdateNotice } from './updateNoticeLogic';

const ENABLED_KEY = 'gateauto.updateNotice.enabled';
const LAST_CODE_KEY = 'gateauto.updateNotice.versionCode';

export const UPDATE_NOTICE_KIND = 'app-update';

type UpdateOfferLike = {
  remote: {
    latestVersionCode: number;
    latestVersionName: string;
  };
};

/** Default on (missing key = notify). */
export async function loadUpdateNoticeEnabled(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(ENABLED_KEY);
  return raw !== '0';
}

export async function setUpdateNoticeEnabled(on: boolean): Promise<void> {
  await AsyncStorage.setItem(ENABLED_KEY, on ? '1' : '0');
}

export async function loadLastNotifiedUpdateCode(): Promise<number> {
  const raw = await AsyncStorage.getItem(LAST_CODE_KEY);
  const n = raw == null ? 0 : Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export async function markUpdateNotified(versionCode: number): Promise<void> {
  const code = Math.trunc(versionCode);
  if (!(code > 0)) return;
  await AsyncStorage.setItem(LAST_CODE_KEY, String(code));
}

/**
 * Tray ping for a sideload offer. Skips if the toggle is off or this
 * versionCode was already notified (resume must not spam).
 */
export async function notifyUpdateAvailable(
  offer: UpdateOfferLike,
): Promise<boolean> {
  const versionCode = offer.remote.latestVersionCode;
  const [enabled, lastNotifiedCode, nativePrefs] = await Promise.all([
    loadUpdateNoticeEnabled(),
    loadLastNotifiedUpdateCode(),
    getNativeNotificationPrefs(),
  ]);
  if (
    !shouldPostUpdateNotice({
      enabled,
      allEnabled: nativePrefs.all,
      willOffer: true,
      versionCode,
      lastNotifiedCode,
    })
  ) {
    return false;
  }
  const posted = await showUpdateAvailableNotification({
    versionName:
      offer.remote.latestVersionName || String(versionCode),
    versionCode,
  });
  if (posted) await markUpdateNotified(versionCode);
  return posted;
}
