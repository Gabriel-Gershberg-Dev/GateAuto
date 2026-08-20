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
  parseRemoteUpdateConfig,
  readRemoteConfigEntries,
  REMOTE_UPDATE_DEFAULTS,
  type RemoteUpdateConfig,
} from './updateLogic';

const LOG = '[GateAuto update]';

const INSTANCE_KEY = 'gateauto.rc.appInstanceId';
const ANDROID_APP_ID = '1:312116795772:android:3ada4aa772eb622990acf9';

function defaultsMap(): Record<string, string | number> {
  return {
    latest_version_code: REMOTE_UPDATE_DEFAULTS.latestVersionCode,
    latest_version_name: REMOTE_UPDATE_DEFAULTS.latestVersionName,
    apk_url: REMOTE_UPDATE_DEFAULTS.apkUrl,
    release_notes: REMOTE_UPDATE_DEFAULTS.releaseNotes,
  };
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
  const codeValue = getValue(rc, 'latest_version_code');
  const codeAsString = codeValue.asString();
  const codeAsNumber = codeValue.asNumber();
  return parseRemoteUpdateConfig({
    latest_version_code:
      codeAsString ||
      (Number.isFinite(codeAsNumber) && codeAsNumber > 0
        ? String(Math.trunc(codeAsNumber))
        : ''),
    latest_version_name: getValue(rc, 'latest_version_name').asString(),
    apk_url: getValue(rc, 'apk_url').asString(),
    release_notes: getValue(rc, 'release_notes').asString(),
  });
}

type FetchBody = {
  entries?: Record<string, unknown>;
  state?: string;
};

async function fetchViaRest(): Promise<RemoteUpdateConfig> {
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
  const parsed = parseRemoteUpdateConfig(values);
  if (!isFetchedUpdateConfig(parsed)) {
    throw new Error(
      `Remote Config incomplete (state=${body.state ?? 'unknown'})`,
    );
  }
  return parsed;
}

/** Fetch does not touch geofences, PalGate, or Auto-open. */
export async function fetchRemoteUpdateConfig(opts?: {
  force?: boolean;
}): Promise<RemoteUpdateConfig> {
  const force = Boolean(opts?.force);
  const interval = force ? 0 : 60 * 60 * 1000;
  const errors: string[] = [];

  try {
    const remote = await withTimeout(fetchViaRest(), 10_000);
    console.log(
      LOG,
      'REST',
      remote.latestVersionCode,
      remote.latestVersionName,
    );
    return remote;
  } catch (e) {
    const message = e instanceof Error ? e.message : 'REST failed';
    console.log(LOG, 'REST failed', message);
    errors.push(message);
  }

  try {
    const remote = await withTimeout(fetchViaJsSdk(interval), 10_000);
    if (!isFetchedUpdateConfig(remote)) {
      throw new Error('JS SDK returned in-app defaults');
    }
    console.log(
      LOG,
      'JS SDK',
      remote.latestVersionCode,
      remote.latestVersionName,
    );
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
  return REMOTE_UPDATE_DEFAULTS;
}
