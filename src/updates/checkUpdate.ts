import Constants from 'expo-constants';
import { AppState } from 'react-native';
import {
  canRequestPackageInstalls,
  downloadAndInstallApk,
  getInstalledVersionCode,
  hasApkInstaller,
  openInstallPermissionSettings,
} from './apkInstall';
import { fetchRemoteUpdateConfig } from './remoteConfig';
import { loadDevOptionsUnlocked } from './devUnlock';
import { notifyUpdateAvailable } from './updateNotice';
import {
  isIntegerVersionCode,
  parseVersionCode,
  REMOTE_UPDATE_DEFAULTS,
  shouldOfferUpdate,
  type RemoteUpdateConfig,
  type UpdateChannel,
} from './updateLogic';

const LOG = '[GateAuto update]';

export type UpdateOffer = {
  installedVersionCode: number;
  remote: RemoteUpdateConfig;
  channel: UpdateChannel;
};

export type UpdateUiEvent =
  | { kind: 'checking'; channel: UpdateChannel }
  | { kind: 'offer'; offer: UpdateOffer }
  | {
      kind: 'up-to-date';
      installedVersionCode: number;
      versionName: string;
      channel: UpdateChannel;
    }
  | { kind: 'error'; message: string };

type Listener = (event: UpdateUiEvent) => void;

const listeners = new Set<Listener>();
let launchDismissed = false;

export function subscribeUpdateUi(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(event: UpdateUiEvent) {
  for (const listener of listeners) listener(event);
}

export function dismissLaunchUpdatePrompt() {
  launchDismissed = true;
}

function extraAndroidVersionCode(): number {
  const extra = Constants.expoConfig?.extra as
    | { androidVersionCode?: unknown }
    | undefined;
  return parseVersionCode(extra?.androidVersionCode);
}

export async function readInstalledVersionCode(): Promise<number> {
  const native = await getInstalledVersionCode();
  if (native > 0) {
    console.log(LOG, 'installed versionCode', native, '(native)');
    return native;
  }

  const platformCode = parseVersionCode(
    Constants.platform?.android?.versionCode,
  );
  if (platformCode > 0) {
    console.log(LOG, 'installed versionCode', platformCode, '(platform)');
    return platformCode;
  }

  const nativeBuild = (Constants as { nativeBuildVersion?: unknown })
    .nativeBuildVersion;
  if (isIntegerVersionCode(nativeBuild)) {
    const code = parseVersionCode(nativeBuild);
    if (code > 0) {
      console.log(LOG, 'installed versionCode', code, '(nativeBuildVersion)');
      return code;
    }
  }

  const extra = extraAndroidVersionCode();
  if (extra > 0) {
    console.log(LOG, 'installed versionCode', extra, '(extra)');
    return extra;
  }

  const fromConfig = parseVersionCode(
    Constants.expoConfig?.android?.versionCode,
  );
  const code = fromConfig > 0 ? fromConfig : 1;
  console.log(LOG, 'installed versionCode', code, '(expoConfig)');
  return code;
}

export async function checkAppUpdate(
  reason: 'enter' | 'launch' | 'settings' | 'beta',
): Promise<void> {
  const channel: UpdateChannel = reason === 'beta' ? 'beta' : 'production';
  const isEnter = reason === 'enter' || reason === 'launch';
  const isManual = reason === 'settings' || reason === 'beta';
  if (reason === 'beta' && !(await loadDevOptionsUnlocked())) {
    return;
  }
  if (isManual) emit({ kind: 'checking', channel });
  try {
    const [installedVersionCode, channels] = await Promise.all([
      readInstalledVersionCode(),
      fetchRemoteUpdateConfig({ force: true }),
    ]);
    const remote = channels[channel];
    const offer: UpdateOffer = { installedVersionCode, remote, channel };
    const willOffer = shouldOfferUpdate(offer);
    console.log(
      LOG,
      reason,
      channel,
      'installed',
      installedVersionCode,
      'remote',
      remote.latestVersionCode,
      remote.latestVersionName,
      willOffer ? 'offer' : 'no-offer',
    );
    if (willOffer) {
      if (isEnter && launchDismissed) {
        await notifyUpdateAvailable(offer);
        return;
      }
      // In-app sheet only while the UI is up — don't double-ping the tray.
      if (isEnter && AppState.currentState !== 'active') {
        await notifyUpdateAvailable(offer);
        return;
      }
      emit({ kind: 'offer', offer });
      return;
    }
    if (isManual) {
      emit({
        kind: 'up-to-date',
        installedVersionCode,
        versionName:
          remote.latestVersionName ||
          Constants.expoConfig?.version ||
          REMOTE_UPDATE_DEFAULTS.latestVersionName,
        channel,
      });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Update check failed';
    console.log(LOG, reason, 'error', message);
    if (isManual) {
      emit({ kind: 'error', message });
    }
  }
}

export async function beginDownloadAndInstall(apkUrl: string): Promise<void> {
  if (!hasApkInstaller()) {
    throw new Error('APK installer is not in this build.');
  }
  const allowed = await canRequestPackageInstalls();
  if (!allowed) {
    await openInstallPermissionSettings();
    throw new Error('ALLOW_INSTALLS');
  }
  await downloadAndInstallApk(apkUrl);
}

export async function requestInstallPermission(): Promise<void> {
  await openInstallPermissionSettings();
}
