export type UpdateChannel = 'production' | 'beta';

export type RemoteUpdateConfig = {
  latestVersionCode: number;
  latestVersionName: string;
  apkUrl: string;
  releaseNotes: string;
};

export type RemoteUpdateChannels = {
  production: RemoteUpdateConfig;
  beta: RemoteUpdateConfig;
};

export const RC_PRODUCTION_KEYS = {
  code: 'latest_version_code',
  name: 'latest_version_name',
  url: 'apk_url',
  notes: 'release_notes',
} as const;

export const RC_BETA_KEYS = {
  code: 'beta_version_code',
  name: 'beta_version_name',
  url: 'beta_apk_url',
  notes: 'beta_release_notes',
} as const;

export const RC_UPDATE_KEYS = [
  RC_PRODUCTION_KEYS.code,
  RC_PRODUCTION_KEYS.name,
  RC_PRODUCTION_KEYS.url,
  RC_PRODUCTION_KEYS.notes,
  RC_BETA_KEYS.code,
  RC_BETA_KEYS.name,
  RC_BETA_KEYS.url,
  RC_BETA_KEYS.notes,
] as const;

export const REMOTE_UPDATE_DEFAULTS: RemoteUpdateConfig = {
  latestVersionCode: 2,
  latestVersionName: '1.0.1',
  apkUrl: '',
  releaseNotes: '',
};

export const REMOTE_BETA_DEFAULTS: RemoteUpdateConfig = {
  latestVersionCode: 0,
  latestVersionName: '',
  apkUrl: '',
  releaseNotes: '',
};

export const REMOTE_UPDATE_CHANNELS_DEFAULTS: RemoteUpdateChannels = {
  production: REMOTE_UPDATE_DEFAULTS,
  beta: REMOTE_BETA_DEFAULTS,
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

type ChannelKeyMap = {
  code: string;
  name: string;
  url: string;
  notes: string;
};

export function parseChannelUpdateConfig(
  values: Record<string, string | undefined>,
  keys: ChannelKeyMap,
): RemoteUpdateConfig {
  const apkUrl = String(values[keys.url] ?? '').trim();
  return {
    latestVersionCode: parseVersionCode(values[keys.code]),
    latestVersionName: String(values[keys.name] ?? '').trim(),
    apkUrl,
    releaseNotes: String(values[keys.notes] ?? '').trim(),
  };
}

export function parseRemoteUpdateConfig(
  values: Record<string, string | undefined>,
): RemoteUpdateConfig {
  return parseChannelUpdateConfig(values, RC_PRODUCTION_KEYS);
}

export function parseBetaUpdateConfig(
  values: Record<string, string | undefined>,
): RemoteUpdateConfig {
  return parseChannelUpdateConfig(values, RC_BETA_KEYS);
}

export function parseRemoteUpdateChannels(
  values: Record<string, string | undefined>,
): RemoteUpdateChannels {
  return {
    production: parseRemoteUpdateConfig(values),
    beta: parseBetaUpdateConfig(values),
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

/**
 * Offer a sideload only when the channel's versionCode is strictly newer.
 * A phone on a beta APK above production is not asked to "update" downward.
 */
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
