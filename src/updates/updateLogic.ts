export type RemoteUpdateConfig = {
  latestVersionCode: number;
  latestVersionName: string;
  apkUrl: string;
  releaseNotes: string;
};

export const REMOTE_UPDATE_DEFAULTS: RemoteUpdateConfig = {
  latestVersionCode: 2,
  latestVersionName: '1.0.1',
  apkUrl: '',
  releaseNotes: '',
};

const HTTPS = /^https:\/\//i;

export function parseVersionCode(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.trunc(raw);
  }
  const n = Number.parseInt(String(raw ?? '').trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

/** True for Android versionCode strings like "3", not versionName "1.0.2". */
export function isIntegerVersionCode(raw: unknown): boolean {
  return /^\d+$/.test(String(raw ?? '').trim());
}

/**
 * Firebase fetch REST returns `{ "key": "value" }` strings (and sometimes
 * numbers). Older docs used `{ "key": { "value": "..." } }`. Accept both.
 */
export function readRemoteConfigEntries(
  entries: Record<string, unknown> | undefined,
): Record<string, string> {
  const values: Record<string, string> = {};
  if (!entries) return values;
  for (const [key, entry] of Object.entries(entries)) {
    if (typeof entry === 'string') {
      values[key] = entry;
      continue;
    }
    if (typeof entry === 'number' && Number.isFinite(entry)) {
      values[key] = String(entry);
      continue;
    }
    if (entry && typeof entry === 'object' && 'value' in entry) {
      const inner = (entry as { value?: unknown }).value;
      if (inner != null && inner !== '') values[key] = String(inner);
    }
  }
  return values;
}

export function parseRemoteUpdateConfig(
  values: Record<string, string | undefined>,
): RemoteUpdateConfig {
  const apkUrl = String(values.apk_url ?? '').trim();
  return {
    latestVersionCode: parseVersionCode(values.latest_version_code),
    latestVersionName: String(values.latest_version_name ?? '').trim(),
    apkUrl,
    releaseNotes: String(values.release_notes ?? '').trim(),
  };
}

/** Server payload we can act on — not in-app defaults with an empty apk_url. */
export function isFetchedUpdateConfig(remote: RemoteUpdateConfig): boolean {
  return remote.latestVersionCode > 0 && isHttpsApkUrl(remote.apkUrl);
}

export function isHttpsApkUrl(url: string): boolean {
  if (!HTTPS.test(url)) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

export function shouldOfferUpdate(opts: {
  installedVersionCode: number;
  remote: RemoteUpdateConfig;
}): boolean {
  const installed = Math.max(0, Math.trunc(opts.installedVersionCode));
  return (
    opts.remote.latestVersionCode > installed &&
    isHttpsApkUrl(opts.remote.apkUrl)
  );
}
