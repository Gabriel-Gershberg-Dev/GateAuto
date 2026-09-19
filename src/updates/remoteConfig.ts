import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchAndActivate, getRemoteConfig, getValue, isSupported } from 'firebase/remote-config';
import { firebaseApp } from '../firebase/app';
import {
  ANDROID_PACKAGE_NAME,
  FIREBASE_PROJECT_ID,
  firebaseWebConfig,
} from '../firebase/config';
import {
  isFetchedUpdateConfig,
  parseRemoteUpdateChannels,
  readRemoteConfigEntries,
  RC_BETA_KEYS,
  RC_PRODUCTION_KEYS,
  RC_UPDATE_KEYS,
  REMOTE_UPDATE_CHANNELS_DEFAULTS,
  REMOTE_UPDATE_DEFAULTS,
  type RemoteUpdateChannels,
} from './updateLogic';

const LOG = '[GateAuto update]';

const INSTANCE_KEY = 'gateauto.rc.appInstanceId';
const ANDROID_APP_ID = '1:312116795772:android:3ada4aa772eb622990acf9';

/**
 * Production: latest_version_code, latest_version_name, apk_url, release_notes
 * Beta:       beta_version_code, beta_version_name, beta_apk_url, beta_release_notes
 *
 * Default publish (scripts/publish-update.mjs) updates beta only.
 * Do not bump production until the owner explicitly asks — family phones
 * only see production Check for update / enter / foreground offers.
 */
function defaultsMap(): Record<string, string | number> {
  return {
    [RC_PRODUCTION_KEYS.code]: REMOTE_UPDATE_DEFAULTS.latestVersionCode,
    [RC_PRODUCTION_KEYS.name]: REMOTE_UPDATE_DEFAULTS.latestVersionName,
    [RC_PRODUCTION_KEYS.url]: REMOTE_UPDATE_DEFAULTS.apkUrl,
    [RC_PRODUCTION_KEYS.notes]: REMOTE_UPDATE_DEFAULTS.releaseNotes,
    [RC_BETA_KEYS.code]: 0,
    [RC_BETA_KEYS.name]: '',
    [RC_BETA_KEYS.url]: '',
    [RC_BETA_KEYS.notes]: '',
  };
}

function rcEntryString(
  rc: ReturnType<typeof getRemoteConfig>,
  key: string,
  numericFallback: boolean,
): string {
  const value = getValue(rc, key);
  const asString = value.asString();
  if (asString) return asString;
  if (numericFallback) {
    const asNumber = value.asNumber();
    if (Number.isFinite(asNumber) && asNumber > 0) {
      return String(Math.trunc(asNumber));
    }
  }
  return '';
}

async function appInstanceId(): Promise<string> {
  const existing = await AsyncStorage.getItem(INSTANCE_KEY);
  if (existing && /^[0-9a-f]{32}$/i.test(existing)) return existing;
  const bytes = Array.from({ length: 16 }, () =>
    Math.floor(Math.random() * 256),
  );
  const id = bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
  await AsyncStorage.setItem(INSTANCE_KEY, id);
  return id;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Remote Config timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function fetchViaJsSdk(minimumFetchIntervalMillis: number) {
  const supported = await isSupported();
  if (!supported) {
    throw new Error('Remote Config JS SDK not supported');
  }
  const rc = getRemoteConfig(firebaseApp);
  rc.settings.minimumFetchIntervalMillis = minimumFetchIntervalMillis;
  rc.defaultConfig = defaultsMap();
  await fetchAndActivate(rc);
  const values: Record<string, string> = {};
  for (const key of RC_UPDATE_KEYS) {
    const numeric = key === RC_PRODUCTION_KEYS.code || key === RC_BETA_KEYS.code;
    values[key] = rcEntryString(rc, key, numeric);
  }
  return parseRemoteUpdateChannels(values);
}

type FetchBody = {
  entries?: Record<string, unknown>;
  state?: string;
};

async function fetchViaRest(): Promise<RemoteUpdateChannels> {
  const instanceId = await appInstanceId();
  const url = `https://firebaseremoteconfig.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/namespaces/firebase:fetch?key=${encodeURIComponent(firebaseWebConfig.apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      appId: ANDROID_APP_ID,
      appInstanceId: instanceId,
      packageName: ANDROID_PACKAGE_NAME,
      appVersion: REMOTE_UPDATE_DEFAULTS.latestVersionName,
      sdkVersion: '21.6.0',
    }),
  });
  if (!res.ok) {
    throw new Error(`Remote Config HTTP ${res.status}`);
  }
  const body = (await res.json()) as FetchBody;
  const values = readRemoteConfigEntries(body.entries);
  const parsed = parseRemoteUpdateChannels(values);
  if (!isFetchedUpdateConfig(parsed.production)) {
    throw new Error(
      `Remote Config incomplete (state=${body.state ?? 'unknown'})`,
    );
  }
  return parsed;
}

function logChannels(source: string, channels: RemoteUpdateChannels) {
  console.log(
    LOG,
    source,
    'prod',
    channels.production.latestVersionCode,
    channels.production.latestVersionName,
    'beta',
    channels.beta.latestVersionCode || 0,
    channels.beta.latestVersionName || '-',
  );
}

/** Fetch does not touch geofences, PalGate, or Auto-open. */
export async function fetchRemoteUpdateConfig(opts?: {
  force?: boolean;
}): Promise<RemoteUpdateChannels> {
  const force = Boolean(opts?.force);
  const interval = force ? 0 : 60 * 60 * 1000;
  const errors: string[] = [];

  try {
    const remote = await withTimeout(fetchViaRest(), 10_000);
    logChannels('REST', remote);
    return remote;
  } catch (e) {
    const message = e instanceof Error ? e.message : 'REST failed';
    console.log(LOG, 'REST failed', message);
    errors.push(message);
  }

  try {
    const remote = await withTimeout(fetchViaJsSdk(interval), 10_000);
    if (!isFetchedUpdateConfig(remote.production)) {
      throw new Error('JS SDK returned in-app defaults');
    }
    logChannels('JS SDK', remote);
    return remote;
  } catch (e) {
    const message = e instanceof Error ? e.message : 'JS SDK failed';
    console.log(LOG, 'JS SDK failed', message);
    errors.push(message);
  }

  if (force) {
    throw new Error(errors.join('; ') || 'Remote Config fetch failed');
  }
  console.log(LOG, 'using in-app defaults');
  return REMOTE_UPDATE_CHANNELS_DEFAULTS;
}
