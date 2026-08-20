import { NativeModules, Platform } from 'react-native';

type GateAutoApkInstallNative = {
  getInstalledVersionCode(): Promise<number>;
  canRequestPackageInstalls(): Promise<boolean>;
  openInstallPermissionSettings(): Promise<boolean>;
  downloadAndInstall(url: string): Promise<boolean>;
};

function getNative(): GateAutoApkInstallNative | null {
  if (Platform.OS !== 'android') return null;
  const mod = NativeModules.GateAutoApkInstall as
    | GateAutoApkInstallNative
    | undefined;
  return mod ?? null;
}

export function hasApkInstaller(): boolean {
  return getNative() != null;
}

export async function getInstalledVersionCode(): Promise<number> {
  const native = getNative();
  if (native?.getInstalledVersionCode) {
    try {
      const code = await native.getInstalledVersionCode();
      if (Number.isFinite(code) && code > 0) return Math.trunc(code);
    } catch {
      /* fall through */
    }
  }
  return 0;
}

export async function canRequestPackageInstalls(): Promise<boolean> {
  const native = getNative();
  if (!native?.canRequestPackageInstalls) return false;
  try {
    return await native.canRequestPackageInstalls();
  } catch {
    return false;
  }
}

export async function openInstallPermissionSettings(): Promise<void> {
  const native = getNative();
  if (!native?.openInstallPermissionSettings) return;
  await native.openInstallPermissionSettings();
}

export async function downloadAndInstallApk(url: string): Promise<void> {
  const native = getNative();
  if (!native?.downloadAndInstall) {
    throw new Error('APK installer is not in this build.');
  }
  await native.downloadAndInstall(url);
}
