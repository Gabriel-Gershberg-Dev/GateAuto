import { Platform } from 'react-native';
import Constants from 'expo-constants';
import {
  getAnalytics,
  logEvent,
  setUserId as setAnalyticsUserId,
} from '@react-native-firebase/analytics';
import {
  getCrashlytics,
  log,
  recordError,
  setAttributes,
  setUserId as setCrashlyticsUserId,
} from '@react-native-firebase/crashlytics';
import { clampInt, flag01, sanitizeParams } from './privacy';
import { TELEMETRY_EVENTS, type AutoOpenPayload, type AutoSkipPayload, type KeepaliveTickResult, type MappedTelemetry, type PermissionStatePayload, type SettingsSavePayload } from './types';

function analyticsOrNull() {
  try {
    if (Platform.OS !== 'android') return null;
    return getAnalytics();
  } catch {
    return null;
  }
}

function crashlyticsOrNull() {
  try {
    if (Platform.OS !== 'android') return null;
    return getCrashlytics();
  } catch {
    return null;
  }
}

function logAnalytics(
  name: string,
  params: Record<string, string | number | undefined>,
): void {
  const analytics = analyticsOrNull();
  if (!analytics) return;
  try {
    logEvent(analytics, name, sanitizeParams(params));
  } catch {
    // Native Analytics must never break auto-open.
  }
}

export function breadcrumb(message: string): void {
  const crash = crashlyticsOrNull();
  if (!crash) return;
  try {
    log(crash, message.slice(0, 120));
  } catch {
    // ignore
  }
}

export function logAutoOpen(payload: AutoOpenPayload): void {
  logAnalytics(TELEMETRY_EVENTS.autoOpen, {
    source: payload.source,
    gate_hash: payload.gateHash,
    distance_m: clampInt(payload.distanceM),
    radius_m: clampInt(payload.radiusM, 1, 250),
    bt_required: flag01(payload.btRequired),
    latency_ms: clampInt(payload.latencyMs),
    warm: payload.warm == null ? undefined : flag01(payload.warm),
  });
  breadcrumb(
    `open ${payload.source} ${payload.gateHash ?? ''} ${clampInt(payload.distanceM) ?? '?'}m`,
  );
}

export function logAutoSkip(payload: AutoSkipPayload): void {
  logAnalytics(TELEMETRY_EVENTS.autoSkip, {
    reason: payload.reason,
    source: payload.source,
    gate_hash: payload.gateHash,
    distance_m: clampInt(payload.distanceM),
    radius_m: clampInt(payload.radiusM, 1, 250),
  });
  breadcrumb(
    `skip ${payload.reason} ${payload.source ?? ''} ${payload.gateHash ?? ''}`,
  );
}

export function logKeepaliveTick(result: KeepaliveTickResult): void {
  logAnalytics(TELEMETRY_EVENTS.keepaliveTick, { result });
  if (result === 'hung_killed') breadcrumb('keepalive hung_killed');
}

export function logPermissionState(payload: PermissionStatePayload): void {
  logAnalytics(TELEMETRY_EVENTS.permissionState, {
    always_loc: flag01(payload.alwaysLoc),
    notifications: flag01(payload.notifications),
    bt_connect: flag01(payload.btConnect),
    battery_unrestricted: flag01(payload.batteryUnrestricted),
  });
}

export function logSettingsSave(payload: SettingsSavePayload): void {
  const changed =
    payload.changedRadius && payload.changedBt
      ? 'radius_bt'
      : payload.changedRadius
        ? 'radius'
        : 'bt';
  logAnalytics(TELEMETRY_EVENTS.settingsSave, {
    changed,
    radius_m: clampInt(payload.radiusM, 1, 250),
    bt_required: flag01(payload.btRequired),
  });
}

export function emitMapped(mapped: MappedTelemetry): void {
  if (mapped.type === 'auto_open') {
    logAutoOpen(mapped);
    return;
  }
  logAutoSkip(mapped);
}

export async function setTelemetryUser(uid: string | null): Promise<void> {
  const id = uid?.trim() || '';
  try {
    const crash = crashlyticsOrNull();
    if (crash) await setCrashlyticsUserId(crash, id);
  } catch {
    // ignore
  }
  try {
    const analytics = analyticsOrNull();
    if (analytics) await setAnalyticsUserId(analytics, id || null);
  } catch {
    // ignore
  }
}

export async function setCrashKeys(keys: {
  autoOn?: boolean;
  fenceCount?: number;
  alwaysLocation?: boolean;
}): Promise<void> {
  const crash = crashlyticsOrNull();
  if (!crash) return;
  const version =
    Constants.expoConfig?.version ??
    Constants.nativeApplicationVersion ??
    'unknown';
  const attrs: Record<string, string> = { version };
  if (keys.autoOn != null) attrs.auto_on = keys.autoOn ? '1' : '0';
  if (keys.fenceCount != null) {
    attrs.fence_count = String(Math.max(0, Math.round(keys.fenceCount)));
  }
  if (keys.alwaysLocation != null) {
    attrs.always_location = keys.alwaysLocation ? '1' : '0';
  }
  try {
    await setAttributes(crash, attrs);
  } catch {
    // ignore
  }
}

/**
 * Unexpected failures only. PalGate HTTP / expected skips must not call this.
 */
export function recordUnexpected(error: unknown, context?: string): void {
  const crash = crashlyticsOrNull();
  if (!crash) return;
  const err =
    error instanceof Error ? error : new Error(String(error ?? 'unknown'));
  try {
    if (context) breadcrumb(`unexpected ${context}`);
    recordError(crash, err, context);
  } catch {
    // ignore
  }
}
