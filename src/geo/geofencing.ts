/**
 * Geofence monitoring + open pipeline.
 *
 * Triggers while monitoring is ON:
 *   Native (locked / swipe-away — JS often does not run):
 *     Play ENTER/EXIT + BT connect open PalGate in Java. Recover alarm /
 *     SCREEN_ON refreshes Play fences (INITIAL_TRIGGER 0) and pollNearby if
 *     last loc is inside radius (Samsung often never delivers ENTER locked).
 *   JS (foreground / Expo keep-alive when the process is actually alive):
 *   1) OS geofence ENTER → refine (≤ radius) → BT (retry) → open
 *   2) OS geofence EXIT → refine (≤ radius×2, absolute ≤250m) → BT (retry) → open
 *   3) Car Bluetooth connect → same proximity refine (≤ radius, ≤250m) → open
 *   4) Eligible-now on arm / app foreground → refine + currently-connected BT → open
 *   5) Eligibility poll (~30s FGS wake, or native cooldown wake) →
 *      inside radius + listed car if BT-required → open (poll_open)
 *      After a successful open, next auto-open is gated only by gate.cooldownMs.
 *   Already inside home? ENTER will not re-fire (no INITIAL_TRIGGER) — wait
 *   for EXIT, car BT connect, eligible-now, or cooldown poll while still inside.
 *
 * Silent low-importance FGS keep-alive on Android while armed (Lowest accuracy
 * wake only; poll takes a one-shot High fix). Force Stop still fully disables
 * until the user opens the app.
 *
 * Expected data APIs (src/data — adopt / keep these names):
 *   gatesStore: loadGates, getGate, saveGates, upsertGate,
 *               isMonitoringEnabled, setMonitoringEnabled
 *               GateConfig: id, deviceId, name, enabled, lat, lng, radiusMeters,
 *                           cooldownMs, bluetooth{required,devices[{name?,address?}]},
 *                           lastOpenedAt, lastResult
 *   eventLog:   appendEvent({ kind, gateId?, message, distanceM?, accuracyM?, trigger? })
 *
 * UI MonitoringScreen should call:
 *   startMonitoring | stopMonitoring | isMonitoringEnabled | syncGeofences
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { openGate, PalGateApiError } from '../palgate/api';
import { loadCredentials, loadCredentialsForGate } from '../data/credentials';
import {
  displayGateName,
  getGate,
  loadGates,
  upsertGate,
  isMonitoringEnabled as readMonitoringFlag,
  setMonitoringEnabled,
  type GateConfig,
} from '../data/gatesStore';
import { appendEvent, type EventKind } from '../data/eventLog';
import { getActiveUid, hydrateUserScope, scopedAsyncKey } from '../data/userScope';
import {
  assertCanOpen,
  logBlockedOpen,
  recordSuccessfulOpen,
} from '../data/openSafetyLock';
import {
  clearMonitoringStickyNotification,
  ensureNotificationSetup,
  notifyOpenFailure,
  notifyOpenSuccess,
} from '../notifications/notify';
import { publishOpenResult } from '../ui/openResultBus';
import {
  deviceMatchesGateBluetooth,
  isBluetoothConnectMonitorStarted,
  setBluetoothConnectHandler,
  startBluetoothConnectMonitor,
  stopBluetoothConnectMonitor,
} from '../bluetooth/btConnectMonitor';
import type { CarBluetoothDevice } from '../bluetooth/types';
import {
  MONITORING_KEEPALIVE_TASK_NAME,
  startMonitoringKeepAlive,
  stopMonitoringKeepAlive,
} from './monitoringKeepAlive';
import {
  setNativeKeepAliveArmed,
  getNativeKeepAliveArmed,
  startNativeLocationFgs,
  syncNativeMonitoring,
  scheduleCooldownWake,
  nativeRegionFromGate,
  tryClaimNativeOpen,
  markNativeOpened,
  releaseNativeClaim,
  getNativeLastOpened,
  importNativeOpenEvents,
  writeNativeCredentials,
} from '../platform/keepAliveAlarm';
import { cooldownRemainingMs } from './cooldown';
import {
  ABSOLUTE_MAX_OPEN_DISTANCE_M,
  refineArrival,
  type RefineOk,
  type RefineResult,
  type RefineTrigger,
} from './refine';

export const GEOFENCE_TASK_NAME = 'GATEAUTO_GEOFENCE_TASK';

/**
 * Legacy monitoring location-watch task name. Kept so we can stop any old
 * continuous-GPS FGS left over from earlier builds. Do not start it.
 */
export const LOCATION_WATCH_TASK_NAME = 'GATEAUTO_LOCATION_WATCH_TASK';

export type { GateConfig };

function geofenceSyncAtKey(): string {
  return scopedAsyncKey('lastGeofenceSyncAt');
}

function monitoringArmedAtKey(): string {
  return scopedAsyncKey('lastMonitoringArmedAt');
}
/** Ignore ENTER only shortly after Off→On rewrite (already-inside spam). Never blocks EXIT or BT-connect. */
const ENTER_DEBOUNCE_AFTER_SYNC_MS = 12_000;
/** Retry car BT on ENTER/EXIT while head unit finishes connecting. */
const BT_RETRY_INTERVAL_MS = 3_000;
const BT_RETRY_WINDOW_MS = 45_000;
/**
 * Light spam guard for eligible-now *checks* only (GPS refine cost).
 * Must NOT override gate.cooldownMs — opens are gated by lastOpenedAt + cooldown.
 */
const ELIGIBLE_NOW_CHECK_MIN_MS = 5_000;
/** Debounce keep-alive location bursts. Cooldown wakes use force and skip this. */
const POLL_MIN_GAP_MS = 8_000;
/** Throttle far-away poll skip logs (opens / near-misses always log). */
const POLL_FAR_LOG_MIN_MS = 5 * 60_000;

export type MonitoringArmStatus = {
  flagOn: boolean;
  geofenceCount: number;
  geofencingActive: boolean;
  btWatchOn: boolean;
  keepAliveOn: boolean;
  lastArmedAt: number | null;
};

type CarBluetoothRequirement = {
  name?: string;
  address?: string;
};

type CarBluetoothModule = {
  isCarBluetoothConnected?: (
    required: CarBluetoothRequirement | CarBluetoothRequirement[],
  ) => Promise<boolean>;
};

let lastGeofenceSyncAt = 0;
let btHandlerWired = false;
const lastEligibleNowCheckByGate = new Map<string, number>();
let eligibleNowRunning: Promise<void> | null = null;
let lastPollAt = 0;
let pollRunning: Promise<void> | null = null;
const lastPollFarLogByGate = new Map<string, number>();

/** Drop in-memory geofence debounce so a new uid does not inherit the last user’s sync time. */
export function resetGeofenceSessionMemory(): void {
  lastGeofenceSyncAt = 0;
  lastEligibleNowCheckByGate.clear();
  lastPollAt = 0;
  lastPollFarLogByGate.clear();
}

function loadCarBluetoothModule(): CarBluetoothModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('../bluetooth/carBluetooth') as CarBluetoothModule;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isGeofenceReady(gate: GateConfig): boolean {
  return (
    gate.enabled &&
    typeof gate.lat === 'number' &&
    Number.isFinite(gate.lat) &&
    typeof gate.lng === 'number' &&
    Number.isFinite(gate.lng) &&
    Number.isFinite(gate.radiusMeters) &&
    gate.radiusMeters > 0
  );
}

async function getEnabledGeofenceGates(): Promise<GateConfig[]> {
  const gates = await loadGates();
  return gates.filter(isGeofenceReady);
}

async function patchGate(
  gateId: string,
  patch: Partial<Pick<GateConfig, 'lastOpenedAt' | 'lastResult'>>,
): Promise<void> {
  const gate = await getGate(gateId);
  if (!gate) return;
  await upsertGate({ ...gate, ...patch });
}

async function markGeofenceSynced(): Promise<void> {
  lastGeofenceSyncAt = Date.now();
  try {
    await hydrateUserScope();
    await AsyncStorage.setItem(geofenceSyncAtKey(), String(lastGeofenceSyncAt));
  } catch {
    // ignore
  }
}

async function getLastGeofenceSyncAt(): Promise<number> {
  if (lastGeofenceSyncAt > 0) return lastGeofenceSyncAt;
  try {
    await hydrateUserScope();
    const raw = await AsyncStorage.getItem(geofenceSyncAtKey());
    const n = raw ? Number(raw) : 0;
    if (Number.isFinite(n) && n > 0) {
      lastGeofenceSyncAt = n;
      return n;
    }
  } catch {
    // ignore
  }
  return 0;
}

async function checkCarBluetooth(gate: GateConfig): Promise<'ok' | 'skipped_bt'> {
  if (!gate.bluetooth?.required) return 'ok';

  const devices = gate.bluetooth.devices ?? [];
  const requirements: CarBluetoothRequirement[] = devices
    .map((d) => ({
      name: d.name?.trim() || undefined,
      address: d.address?.trim() || undefined,
    }))
    .filter((d) => Boolean(d.name || d.address));

  // Fail closed: required but no devices configured.
  if (requirements.length === 0) {
    console.log('[GateAuto] skipped_bt — required but no devices configured');
    return 'skipped_bt';
  }

  const mod = loadCarBluetoothModule();
  const helper = mod?.isCarBluetoothConnected;
  if (typeof helper !== 'function') {
    console.log('[GateAuto] skipped_bt — carBluetooth helper missing');
    return 'skipped_bt';
  }

  try {
    const connected = await helper(requirements);
    return connected ? 'ok' : 'skipped_bt';
  } catch (error) {
    console.log('[GateAuto] skipped_bt — carBluetooth helper error', error);
    return 'skipped_bt';
  }
}

/** Retry BT for ~25–30s so late head-unit connects still open on ENTER/EXIT. */
async function checkCarBluetoothWithRetry(
  gate: GateConfig,
  trigger: 'enter' | 'exit' = 'enter',
): Promise<'ok' | 'skipped_bt'> {
  if (!gate.bluetooth?.required) return 'ok';

  const deadline = Date.now() + BT_RETRY_WINDOW_MS;
  let attempt = 0;
  while (true) {
    attempt += 1;
    const result = await checkCarBluetooth(gate);
    if (result === 'ok') {
      if (attempt > 1) {
        console.log(
          `[GateAuto] BT connected on ${trigger.toUpperCase()} retry attempt ${attempt}`,
        );
      }
      return 'ok';
    }
    const now = Date.now();
    if (now + BT_RETRY_INTERVAL_MS > deadline) {
      return 'skipped_bt';
    }
    await sleep(BT_RETRY_INTERVAL_MS);
  }
}

/**
 * Notifications + foreground/background location needed before geofencing.
 * Best-effort: requests what is missing; does not throw on denial.
 */
async function ensureMonitoringPermissions(): Promise<void> {
  await ensureNotificationSetup();
  const notif = await Notifications.getPermissionsAsync();
  if (!notif.granted) {
    await Notifications.requestPermissionsAsync();
  }

  const foreground = await Location.getForegroundPermissionsAsync();
  if (!foreground.granted) {
    await Location.requestForegroundPermissionsAsync();
  }

  const background = await Location.getBackgroundPermissionsAsync();
  if (!background.granted) {
    await Location.requestBackgroundPermissionsAsync();
  }
}

/** Tear down legacy continuous location FGS if an older build left it running. */
async function stopLegacyLocationWatch(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_WATCH_TASK_NAME)) {
      await Location.stopLocationUpdatesAsync(LOCATION_WATCH_TASK_NAME);
    }
  } catch (error) {
    console.warn('[GateAuto] stop legacy location watch failed', error);
  }
}

/** Always dismiss old noisy armed sticky — keep-alive FGS uses its own quiet notif. */
async function dismissArmedSticky(): Promise<void> {
  await clearMonitoringStickyNotification();
}

function regionsFromGates(gates: GateConfig[]): Location.LocationRegion[] {
  return gates.map((g) => ({
    identifier: g.id,
    latitude: g.lat as number,
    longitude: g.lng as number,
    radius: g.radiusMeters,
    notifyOnEnter: true,
    notifyOnExit: true,
  }));
}

function ensureBtConnectHandlerWired(): void {
  if (btHandlerWired) return;
  btHandlerWired = true;
  setBluetoothConnectHandler((device) => handleBluetoothDeviceConnected(device));
}

async function startBackgroundHelpers(): Promise<void> {
  ensureBtConnectHandlerWired();
  await startBluetoothConnectMonitor();
  // Expo location FGS + native MonitoringService must start from this UI
  // process. Alarm/SCREEN_ON cannot startForegroundService while locked.
  await startMonitoringKeepAlive();
  await startNativeLocationFgs();
}

/** Restart BT watch + quiet FGS without re-registering geofences. */
export async function ensureMonitoringHelpers(): Promise<void> {
  await startBackgroundHelpers();
}

async function stopBackgroundHelpers(): Promise<void> {
  await stopBluetoothConnectMonitor();
  await stopMonitoringKeepAlive();
}

async function persistArmedAt(ts: number = Date.now()): Promise<void> {
  try {
    await hydrateUserScope();
    await AsyncStorage.setItem(monitoringArmedAtKey(), String(ts));
  } catch {
    // ignore
  }
}

async function readArmedAt(): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(monitoringArmedAtKey());
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** Prefer native armed when present so an Android Auto toggle is honored immediately. */
async function isMonitoringLive(): Promise<boolean> {
  const native = await getNativeKeepAliveArmed();
  if (native !== null) return native;
  return readMonitoringFlag();
}

/** Live arming snapshot for Monitoring UI (flag vs OS geofences vs BT watch). */
export async function getMonitoringArmStatus(): Promise<MonitoringArmStatus> {
  const flagOn = await isMonitoringLive();
  const enabled = flagOn ? await getEnabledGeofenceGates() : [];
  let geofencingActive = false;
  let keepAliveOn = false;
  try {
    geofencingActive = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK_NAME);
  } catch {
    geofencingActive = false;
  }
  if (Platform.OS === 'android') {
    try {
      keepAliveOn = await Location.hasStartedLocationUpdatesAsync(
        MONITORING_KEEPALIVE_TASK_NAME,
      );
    } catch {
      keepAliveOn = false;
    }
  }
  return {
    flagOn,
    geofenceCount: enabled.length,
    geofencingActive,
    btWatchOn: isBluetoothConnectMonitorStarted(),
    keepAliveOn,
    lastArmedAt: await readArmedAt(),
  };
}

async function logMonitoringArmed(reason: string): Promise<void> {
  const status = await getMonitoringArmStatus();
  const when = status.lastArmedAt
    ? new Date(status.lastArmedAt).toLocaleString()
    : 'now';
  await appendEvent({
    kind: 'monitoring_armed',
    message: `Auto-open armed (${reason}): ${status.geofenceCount} geofence(s), OS geofencing ${status.geofencingActive ? 'ON' : 'OFF'}, BT watch ${status.btWatchOn ? 'ON' : 'OFF'}, FGS ${status.keepAliveOn ? 'ON' : 'OFF'}. Last arm ${when}. Already inside? ENTER will not re-fire — eligible-now, car BT connect, EXIT, or native recover poll while inside. Native recover refreshes Play fences (no INITIAL_TRIGGER) then pollNearby.`,
  });
}

/** Re-register geofence regions from currently enabled gates (no-op if monitoring off). */
export async function syncGeofences(): Promise<void> {
  // Always stop the old battery-heavy watch if present.
  await stopLegacyLocationWatch();

  const monitoring = await readMonitoringFlag();
  const allGates = await loadGates();
  const enabled = monitoring ? allGates.filter(isGeofenceReady) : [];
  // Always persist every openable gate so Android Auto can list them while
  // Auto-open is off. Native geofence register still skips disabled / no-pin.
  const nativeRegions = allGates
    .filter((g) => String(g.deviceId ?? '').trim())
    .map((g) => nativeRegionFromGate(g));
  const autoOn = nativeRegions.filter((r) => r.enabled !== false).length;
  console.log(
    `[GateAuto] native sync uid=${getActiveUid() ?? 'none'} gates=${nativeRegions.length} auto-on=${autoOn} monitoring=${monitoring}`,
  );
  const primaryCreds = await loadCredentials();
  if (primaryCreds) {
    await writeNativeCredentials(primaryCreds);
  }
  try {
    const { syncNativeFromSystems } = await import('../data/palgateSystems');
    await syncNativeFromSystems();
  } catch {
    // Native per-gate map is best-effort.
  }
  await syncNativeMonitoring(monitoring, nativeRegions);

  if (!monitoring) {
    if (await Location.hasStartedGeofencingAsync(GEOFENCE_TASK_NAME)) {
      await Location.stopGeofencingAsync(GEOFENCE_TASK_NAME);
    }
    await stopBackgroundHelpers();
    await dismissArmedSticky();
    return;
  }

  // Clear leftover noisy stickies from older builds (keep-alive has its own FGS notif).
  await dismissArmedSticky();

  if (enabled.length === 0) {
    if (await Location.hasStartedGeofencingAsync(GEOFENCE_TASK_NAME)) {
      await Location.stopGeofencingAsync(GEOFENCE_TASK_NAME);
    }
    await startBackgroundHelpers();
    return;
  }

  await Location.startGeofencingAsync(
    GEOFENCE_TASK_NAME,
    regionsFromGates(enabled),
  );
  await startBackgroundHelpers();
}

export async function startMonitoring(): Promise<void> {
  await ensureMonitoringPermissions();
  await hydrateUserScope();
  await setMonitoringEnabled(true);
  // Location FGS from the UI process *before* other awaits — Android 12+
  // rejects startForegroundService after the user locks.
  await startMonitoringKeepAlive();
  try {
    await syncGeofences();
    await persistArmedAt();
    await markGeofenceSynced();
    await logMonitoringArmed('startMonitoring');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await appendEvent({
      kind: 'error',
      message: `Failed to arm monitoring: ${message}`,
    });
  }
  // Already inside + BT already connected produces no ENTER/ACL event —
  // evaluate in the background so turning Auto-open on is not blocked by GPS.
  void checkEligibleNowAndOpen('arm', { force: true }).catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    await appendEvent({
      kind: 'error',
      message: `Failed to check eligibility after arm: ${message}`,
    });
  });
}

export async function stopMonitoring(): Promise<void> {
  await setMonitoringEnabled(false);
  await setNativeKeepAliveArmed(false);
  if (await Location.hasStartedGeofencingAsync(GEOFENCE_TASK_NAME)) {
    await Location.stopGeofencingAsync(GEOFENCE_TASK_NAME);
  }
  await stopLegacyLocationWatch();
  await stopBackgroundHelpers();
  await dismissArmedSticky();
  await appendEvent({
    kind: 'info',
    message:
      'Monitoring stopped — geofences and BT connect watch cleared. Auto-open will not run until you turn Monitoring on again.',
  });
}

export async function isMonitoringEnabled(): Promise<boolean> {
  return isMonitoringLive();
}

async function checkCooldown(
  gate: GateConfig,
  label: string,
): Promise<boolean> {
  const now = Date.now();
  const cooldownMs = gate.cooldownMs > 0 ? gate.cooldownMs : 0;
  const nativeLast = await getNativeLastOpened(gate.id);
  const lastOpenedAt = Math.max(gate.lastOpenedAt ?? 0, nativeLast);
  const remainingMs = cooldownRemainingMs(lastOpenedAt, cooldownMs, now);
  if (remainingMs > 0 && lastOpenedAt > 0) {
    const remainingS = Math.ceil(remainingMs / 1000);
    const nextAllowedAt = new Date(lastOpenedAt + cooldownMs);
    const nextAllowed =
      Number.isFinite(nextAllowedAt.getTime())
        ? nextAllowedAt.toLocaleTimeString()
        : '?';
    await appendEvent({
      kind: 'cooldown',
      gateId: gate.id,
      message: `${label}: cooldown ${remainingS}s remaining (configured ${Math.round(cooldownMs / 1000)}s) · nextAllowedAt ${nextAllowed}`,
    });
    await patchGate(gate.id, { lastResult: 'cooldown' });
    void scheduleCooldownWake(remainingMs + 1_500);
    return false;
  }
  return true;
}

function refineGeoFields(refine: RefineResult): {
  distanceM?: number;
  accuracyM?: number;
  trigger: RefineTrigger;
} {
  return {
    distanceM:
      typeof refine.distanceM === 'number' && Number.isFinite(refine.distanceM)
        ? refine.distanceM
        : undefined,
    accuracyM:
      typeof refine.accuracy === 'number' && Number.isFinite(refine.accuracy)
        ? refine.accuracy
        : undefined,
    trigger: refine.trigger,
  };
}

async function runProximityRefine(
  gate: GateConfig,
  label: string,
  trigger: RefineTrigger,
): Promise<RefineOk | null> {
  let refine: RefineResult;
  try {
    refine = await refineArrival(
      { lat: gate.lat as number, lng: gate.lng as number },
      gate.radiusMeters,
      trigger,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await appendEvent({
      kind: 'error',
      gateId: gate.id,
      message: `${label}: refine failed: ${message}`,
      trigger,
    });
    await patchGate(gate.id, { lastResult: 'error' });
    return null;
  }

  if (!refine.ok) {
    const distanceFail = (refine.detail ?? '').startsWith('distance ');
    const kind =
      trigger === 'bt_connect' && distanceFail
        ? 'bt_connect_outside'
        : 'skipped_refine';
    const agePart =
      typeof refine.ageMs === 'number' && Number.isFinite(refine.ageMs)
        ? `, age ${(refine.ageMs / 1000).toFixed(1)}s`
        : '';
    await appendEvent({
      kind,
      gateId: gate.id,
      message: `${label}: skipped (${trigger}) — ${refine.detail ?? 'refine failed'}${agePart}`,
      ...refineGeoFields(refine),
    });
    await patchGate(gate.id, {
      lastResult: kind,
    });
    return null;
  }

  return refine;
}

function openErrorKind(
  resultKind:
    | 'opened'
    | 'exit_open'
    | 'bt_connect_open'
    | 'eligible_now_open'
    | 'poll_open',
): EventKind {
  if (resultKind === 'eligible_now_open') return 'eligible_now_error';
  if (resultKind === 'poll_open') return 'poll_error';
  return 'error';
}

function formatOpenApiError(error: unknown): string {
  if (error instanceof PalGateApiError) {
    const status = error.status != null ? ` HTTP ${error.status}` : '';
    const body =
      error.body && typeof error.body === 'object'
        ? ` ${JSON.stringify(error.body).slice(0, 160)}`
        : '';
    return `${error.message}${status}${body}`.trim();
  }
  return error instanceof Error ? error.message : String(error);
}

let openInFlight = new Set<string>();

/**
 * Shared auto-open API call. Only logs *_open AFTER openGate resolves with a
 * validated success envelope. Failures log *_error / error with API detail.
 */
async function performOpen(
  gate: GateConfig,
  label: string,
  detail: string,
  resultKind:
    | 'opened'
    | 'exit_open'
    | 'bt_connect_open'
    | 'eligible_now_open'
    | 'poll_open',
  geo?: {
    distanceM?: number;
    accuracyM?: number;
    trigger: RefineTrigger;
  },
): Promise<void> {
  if (openInFlight.has(gate.id)) return;
  openInFlight.add(gate.id);
  const cooldownMs = gate.cooldownMs > 0 ? gate.cooldownMs : 0;
  const claimed = await tryClaimNativeOpen(gate.id, cooldownMs);
  if (!claimed) {
    openInFlight.delete(gate.id);
    return;
  }
  try {
  const deviceId = String(gate.deviceId ?? '').trim();
  const credentials = await loadCredentialsForGate(gate);
  if (!credentials) {
    const failKind = openErrorKind(resultKind);
    const message = `${label}: missing PalGate credentials (deviceId ${deviceId || '?'})`;
    await appendEvent({
      kind: failKind,
      gateId: gate.id,
      message,
      trigger: geo?.trigger,
      distanceM: geo?.distanceM,
      accuracyM: geo?.accuracyM,
    });
    await patchGate(gate.id, { lastResult: 'error' });
    publishOpenResult(gate.id, label, false, 'Not linked to PalGate');
    await notifyOpenFailure(label, 'Not linked to PalGate');
    return;
  }

  if (!deviceId) {
    const failKind = openErrorKind(resultKind);
    const message = `${label}: missing deviceId — cannot open`;
    await appendEvent({
      kind: failKind,
      gateId: gate.id,
      message,
      trigger: geo?.trigger,
      distanceM: geo?.distanceM,
      accuracyM: geo?.accuracyM,
    });
    await patchGate(gate.id, { lastResult: 'error' });
    publishOpenResult(gate.id, label, false, 'Missing deviceId');
    await notifyOpenFailure(label, 'Missing deviceId');
    return;
  }

  try {
    // Must await — never log open before a successful validated API response.
    const apiResult = await openGate(credentials, deviceId);
    const apiSnippet =
      apiResult && typeof apiResult === 'object'
        ? JSON.stringify(apiResult).slice(0, 120)
        : String(apiResult ?? '');

    await recordSuccessfulOpen(gate.id, label);
    await markNativeOpened(gate.id);
    await upsertGate({
      ...gate,
      deviceId,
      lastOpenedAt: Date.now(),
      lastResult: resultKind,
    });
    await appendEvent({
      kind: resultKind,
      gateId: gate.id,
      message: `${label}: ${detail} · deviceId ${deviceId} · API ok ${apiSnippet}`,
      trigger: geo?.trigger,
      distanceM: geo?.distanceM,
      accuracyM: geo?.accuracyM,
    });
    publishOpenResult(gate.id, label, true, 'Opened successfully');
    await notifyOpenSuccess(label);
    const cooldownMs = gate.cooldownMs > 0 ? gate.cooldownMs : 15_000;
    void scheduleCooldownWake(cooldownMs + 1_500);
  } catch (error) {
    const message = formatOpenApiError(error);
    const failKind = openErrorKind(resultKind);
    await appendEvent({
      kind: failKind,
      gateId: gate.id,
      message: `${label}: ${message} · deviceId ${deviceId}`,
      trigger: geo?.trigger,
      distanceM: geo?.distanceM,
      accuracyM: geo?.accuracyM,
    });
    await patchGate(gate.id, { lastResult: 'error' });
    publishOpenResult(gate.id, label, false, message);
    await notifyOpenFailure(label, message);
  }
  } finally {
    void releaseNativeClaim(gate.id);
    openInFlight.delete(gate.id);
  }
}

/**
 * Open pipeline for a single geofence ENTER:
 * debounce after sync → safety lock → cooldown → proximity refine → BT → open.
 */
export async function handleGeofenceEnter(regionIdentifier: string): Promise<void> {
  if (!(await isMonitoringLive())) return;
  const gate = await getGate(regionIdentifier);
  if (!gate || !gate.enabled) {
    console.warn(
      '[GateAuto] geofence enter for unknown/disabled gate',
      regionIdentifier,
    );
    return;
  }

  const label = displayGateName(gate);

  if (!isGeofenceReady(gate)) {
    await appendEvent({
      kind: 'error',
      gateId: gate.id,
      message: `${label}: missing pin/radius for geofence`,
      trigger: 'enter',
    });
    return;
  }

  const syncedAt = await getLastGeofenceSyncAt();
  if (
    syncedAt > 0 &&
    Date.now() - syncedAt < ENTER_DEBOUNCE_AFTER_SYNC_MS
  ) {
    console.log(
      `[GateAuto] ignoring ENTER for ${label} — within ${ENTER_DEBOUNCE_AFTER_SYNC_MS}ms of Off→On rewrite`,
    );
    await appendEvent({
      kind: 'info',
      gateId: gate.id,
      message: `${label}: ignored ENTER after Off→On rewrite (already-inside spam). EXIT / car BT connect / eligible-now still open when eligible.`,
      trigger: 'enter',
    });
    return;
  }

  const safety = await assertCanOpen(gate.id, label);
  if (!safety.ok) {
    await logBlockedOpen(gate.id, label);
    await patchGate(gate.id, { lastResult: 'safety_lock' });
    return;
  }

  if (!(await checkCooldown(gate, label))) return;

  const refine = await runProximityRefine(gate, label, 'enter');
  if (!refine) return;

  const geo = refineGeoFields(refine);
  const bt = await checkCarBluetoothWithRetry(gate, 'enter');
  if (bt === 'skipped_bt') {
    await appendEvent({
      kind: 'skipped_bt',
      gateId: gate.id,
      message: `${label}: required car Bluetooth not connected (after retry window)`,
      ...geo,
    });
    await patchGate(gate.id, { lastResult: 'skipped_bt' });
    return;
  }

  await performOpen(
    gate,
    label,
    `ENTER — accuracy ${refine.accuracy.toFixed(1)}m, distance ${refine.distanceM.toFixed(1)}m`,
    'opened',
    geo,
  );
}

/**
 * Open pipeline for a single geofence EXIT (leaving home toward the gate):
 * safety lock → cooldown → proximity refine → BT (retry) → open.
 * Native EXIT is the locked path (250m city cap; missing last loc allowed).
 * JS refine still runs when the process is alive so a far-away OS EXIT cannot open.
 */
export async function handleGeofenceExit(regionIdentifier: string): Promise<void> {
  if (!(await isMonitoringLive())) return;
  const gate = await getGate(regionIdentifier);
  if (!gate || !gate.enabled) {
    console.warn(
      '[GateAuto] geofence exit for unknown/disabled gate',
      regionIdentifier,
    );
    return;
  }

  const label = displayGateName(gate);

  if (!isGeofenceReady(gate)) {
    await appendEvent({
      kind: 'error',
      gateId: gate.id,
      message: `${label}: missing pin/radius for geofence`,
      trigger: 'exit',
    });
    return;
  }

  const safety = await assertCanOpen(gate.id, label);
  if (!safety.ok) {
    await logBlockedOpen(gate.id, label);
    await patchGate(gate.id, { lastResult: 'safety_lock' });
    return;
  }

  if (!(await checkCooldown(gate, label))) return;

  const refine = await runProximityRefine(gate, label, 'exit');
  if (!refine) return;

  const geo = refineGeoFields(refine);
  const bt = await checkCarBluetoothWithRetry(gate, 'exit');
  if (bt === 'skipped_bt') {
    await appendEvent({
      kind: 'exit_skipped_bt',
      gateId: gate.id,
      message: `${label}: EXIT — required car Bluetooth not connected (after retry window)`,
      ...geo,
    });
    await patchGate(gate.id, { lastResult: 'exit_skipped_bt' });
    return;
  }

  await performOpen(
    gate,
    label,
    `EXIT — accuracy ${refine.accuracy.toFixed(1)}m, distance ${refine.distanceM.toFixed(1)}m`,
    'exit_open',
    geo,
  );
}

/**
 * BT-connect trigger: car head unit connected → fresh high-accuracy proximity
 * refine (same assertNearGate rules as ENTER) → open.
 */
export async function handleBluetoothDeviceConnected(
  device: CarBluetoothDevice,
): Promise<void> {
  const monitoring = await isMonitoringLive();
  if (!monitoring) {
    console.log('[GateAuto] BT connect ignored — monitoring is off');
    await appendEvent({
      kind: 'info',
      message: `BT connect (${device.name}): ignored — monitoring is off`,
      trigger: 'bt_connect',
    });
    return;
  }

  await appendEvent({
    kind: 'info',
    message: `BT connect heard: ${device.name}${device.address ? ` (${device.address})` : ''} — checking gates…`,
    trigger: 'bt_connect',
  });

  const gates = await loadGates();
  const matching = gates.filter((gate) => {
    if (!isGeofenceReady(gate)) return false;
    if (!gate.bluetooth?.required) return false;
    const devices = gate.bluetooth.devices ?? [];
    if (devices.length === 0) return false;
    return deviceMatchesGateBluetooth(device, devices);
  });

  if (matching.length === 0) {
    console.log(
      '[GateAuto] BT connect — no matching auto-open gate',
      device.name,
      device.address,
    );
    await appendEvent({
      kind: 'info',
      message: `BT connect (${device.name}): no matching enabled gate with required Bluetooth — check gate BT device name/address`,
      trigger: 'bt_connect',
    });
    return;
  }

  for (const gate of matching) {
    const label = displayGateName(gate);

    await appendEvent({
      kind: 'info',
      gateId: gate.id,
      message: `${label}: BT matched (${device.name}) — running proximity check`,
      trigger: 'bt_connect',
    });

    const safety = await assertCanOpen(gate.id, label);
    if (!safety.ok) {
      await logBlockedOpen(gate.id, label);
      await patchGate(gate.id, { lastResult: 'safety_lock' });
      continue;
    }

    if (!(await checkCooldown(gate, label))) continue;

    // Fresh high-accuracy fix + assertNearGate — never open on stale/cached GPS.
    const refine = await runProximityRefine(gate, label, 'bt_connect');
    if (!refine) continue;

    await performOpen(
      gate,
      label,
      `BT connect ${device.name}; accuracy ${refine.accuracy.toFixed(1)}m, distance ${refine.distanceM.toFixed(1)}m`,
      'bt_connect_open',
      refineGeoFields(refine),
    );
  }
}

/**
 * Already-inside recovery: fresh GPS + currently-connected car BT (not only
 * new ACL events). Uses the auto-open path (safety lock + cooldown).
 * Debounced per gate so foreground returns do not spam; pass force on arm.
 * Concurrent force requests are not dropped — they re-run after the in-flight check.
 */
export async function checkEligibleNowAndOpen(
  reason: string,
  options?: { force?: boolean },
): Promise<void> {
  const force = options?.force === true;
  if (eligibleNowRunning) {
    await eligibleNowRunning;
    // Forced arm checks must not be swallowed by a concurrent resync.
    if (force) {
      await checkEligibleNowAndOpen(reason, { force: true });
    }
    return;
  }

  eligibleNowRunning = (async () => {
    const monitoring = await isMonitoringLive();
    if (!monitoring) return;

    const gates = await getEnabledGeofenceGates();
    if (gates.length === 0) return;

    const now = Date.now();

    await appendEvent({
      kind: 'info',
      message: `Eligible-now check (${reason}): ${gates.length} gate(s)${force ? ' (forced)' : ''}…`,
      trigger: 'eligible_now',
    });

    for (const gate of gates) {
      const label = displayGateName(gate);
      const lastCheck = lastEligibleNowCheckByGate.get(gate.id) ?? 0;
      // Spam guard for GPS only — open timing is solely gate.cooldownMs via checkCooldown.
      if (!force && now - lastCheck < ELIGIBLE_NOW_CHECK_MIN_MS) {
        continue;
      }
      lastEligibleNowCheckByGate.set(gate.id, now);

      const safety = await assertCanOpen(gate.id, label);
      if (!safety.ok) {
        const remainingMs = safety.remainingMs ?? 0;
        const nextAllowed =
          remainingMs > 0
            ? new Date(Date.now() + remainingMs).toLocaleTimeString()
            : '?';
        await appendEvent({
          kind: 'safety_lock',
          gateId: gate.id,
          message: `${label}: eligible-now skipped — safety lock · nextAllowedAt ${nextAllowed}`,
          trigger: 'eligible_now',
        });
        await patchGate(gate.id, { lastResult: 'safety_lock' });
        continue;
      }

      if (!(await checkCooldown(gate, label))) continue;

      const refine = await runProximityRefine(gate, label, 'eligible_now');
      if (!refine) continue;

      const geo = refineGeoFields(refine);
      const btRequired = Boolean(gate.bluetooth?.required);
      const bt = await checkCarBluetooth(gate);
      if (bt === 'skipped_bt') {
        await appendEvent({
          kind: 'skipped_bt',
          gateId: gate.id,
          message: `${label}: eligible-now skipped — required car Bluetooth not connected`,
          ...geo,
        });
        await patchGate(gate.id, { lastResult: 'skipped_bt' });
        continue;
      }

      await performOpen(
        gate,
        label,
        `eligible-now (${reason}) — accuracy ${refine.accuracy.toFixed(1)}m, distance ${refine.distanceM.toFixed(1)}m, BT ${btRequired ? 'connected' : 'not required'}`,
        'eligible_now_open',
        geo,
      );
    }
  })();

  try {
    await eligibleNowRunning;
  } finally {
    eligibleNowRunning = null;
  }
}

/**
 * Low-rate background eligibility poll (keep-alive FGS wake).
 * One fresh high-accuracy fix per enabled gate + currently-connected BT.
 * Strict assertNearGate (≤ radius, absolute ≤250m). Auto path (safety + cooldown).
 */
export async function runEligibilityPoll(opts?: { force?: boolean }): Promise<void> {
  const now = Date.now();
  if (!opts?.force && now - lastPollAt < POLL_MIN_GAP_MS) {
    return;
  }
  if (pollRunning) {
    await pollRunning;
    return;
  }

  lastPollAt = now;

  pollRunning = (async () => {
    await importNativeOpenEvents();
    const monitoring = await isMonitoringLive();
    if (!monitoring) return;

    const gates = await getEnabledGeofenceGates();
    if (gates.length === 0) return;

    for (const gate of gates) {
      const label = displayGateName(gate);

      if (gate.bluetooth?.required) {
        const bt = await checkCarBluetooth(gate);
        if (bt === 'skipped_bt') {
          continue;
        }
      }

      const safety = await assertCanOpen(gate.id, label);
      if (!safety.ok) {
        const remainingMs = safety.remainingMs ?? 0;
        const nextAllowed =
          remainingMs > 0
            ? new Date(Date.now() + remainingMs).toLocaleTimeString()
            : '?';
        await appendEvent({
          kind: 'safety_lock',
          gateId: gate.id,
          message: `${label}: poll skipped — safety lock · nextAllowedAt ${nextAllowed}`,
          trigger: 'poll',
        });
        await patchGate(gate.id, { lastResult: 'safety_lock' });
        continue;
      }

      if (!(await checkCooldown(gate, label))) continue;

      let refine: RefineResult;
      try {
        refine = await refineArrival(
          { lat: gate.lat as number, lng: gate.lng as number },
          gate.radiusMeters,
          'poll',
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await appendEvent({
          kind: 'error',
          gateId: gate.id,
          message: `${label}: poll refine failed: ${message}`,
          trigger: 'poll',
        });
        await patchGate(gate.id, { lastResult: 'error' });
        continue;
      }

      const geo = refineGeoFields(refine);

      if (!refine.ok) {
        const distanceM = refine.distanceM;
        const farAway =
          typeof distanceM === 'number' &&
          Number.isFinite(distanceM) &&
          distanceM > ABSOLUTE_MAX_OPEN_DISTANCE_M;
        const lastFarLog = lastPollFarLogByGate.get(gate.id) ?? 0;
        if (!farAway || now - lastFarLog >= POLL_FAR_LOG_MIN_MS) {
          if (farAway) lastPollFarLogByGate.set(gate.id, now);
          const agePart =
            typeof refine.ageMs === 'number' && Number.isFinite(refine.ageMs)
              ? `, age ${(refine.ageMs / 1000).toFixed(1)}s`
              : '';
          await appendEvent({
            kind: 'skipped_refine',
            gateId: gate.id,
            message: `${label}: poll skipped — ${refine.detail ?? 'refine failed'}${agePart}`,
            ...geo,
          });
          await patchGate(gate.id, { lastResult: 'skipped_refine' });
        }
        continue;
      }

      await performOpen(
        gate,
        label,
        `poll — accuracy ${refine.accuracy.toFixed(1)}m, distance ${refine.distanceM.toFixed(1)}m${
          gate.bluetooth?.required ? ', listed car connected' : ', BT not required'
        }`,
        'poll_open',
        geo,
      );
    }
  })();

  try {
    await pollRunning;
  } finally {
    pollRunning = null;
  }
}

/**
 * Manual verify: fresh GPS + BT for each enabled gate.
 * When proximity (+ BT if required) pass, opens like Manual Open (bypasses
 * safety lock / cooldown). Events use test_* kinds — excluded from Monitoring log.
 */
export async function testAutoOpenConditions(): Promise<void> {
  const status = await getMonitoringArmStatus();
  await appendEvent({
    kind: 'test_info',
    message: `Test & open if ready — flag ${status.flagOn ? 'ON' : 'OFF'}, ${status.geofenceCount} geofence(s), OS geo ${status.geofencingActive ? 'ON' : 'OFF'}, BT watch ${status.btWatchOn ? 'ON' : 'OFF'}, FGS ${status.keepAliveOn ? 'ON' : 'OFF'}`,
    trigger: 'manual_test',
  });

  const gates = await getEnabledGeofenceGates();
  if (gates.length === 0) {
    await appendEvent({
      kind: 'test_info',
      message:
        'Test: no enabled gates with pin/radius. Set a pin, enable the gate, then turn Monitoring on.',
      trigger: 'manual_test',
    });
    return;
  }

  for (const gate of gates) {
    const label = displayGateName(gate);
    let refine: RefineResult;
    try {
      refine = await refineArrival(
        { lat: gate.lat as number, lng: gate.lng as number },
        gate.radiusMeters,
        'manual_test',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await appendEvent({
        kind: 'test_error',
        gateId: gate.id,
        message: `${label}: test GPS failed: ${message}`,
        trigger: 'manual_test',
      });
      continue;
    }

    const geo = {
      ...refineGeoFields(refine),
      trigger: 'manual_test' as const,
    };
    const btRequired = Boolean(gate.bluetooth?.required);
    const bt = btRequired ? await checkCarBluetooth(gate) : 'ok';

    const blockers: string[] = [];
    if (!refine.ok) blockers.push(refine.detail ?? 'refine failed');
    if (btRequired && bt === 'skipped_bt') blockers.push('car BT not connected');

    if (blockers.length > 0) {
      const kind =
        !refine.ok
          ? 'test_skipped_refine'
          : btRequired && bt === 'skipped_bt'
            ? 'test_skipped_bt'
            : 'test_info';
      await appendEvent({
        kind,
        gateId: gate.id,
        message: `${label}: would NOT open — ${blockers.join('; ')}`,
        ...geo,
      });
      continue;
    }

    // Same as Manual Open — bypass auto safety lock / cooldown so testing works.
    const credentials = await loadCredentialsForGate(gate);
    if (!credentials) {
      await appendEvent({
        kind: 'test_error',
        gateId: gate.id,
        message: `${label}: missing PalGate credentials`,
        ...geo,
      });
      continue;
    }

    const dist =
      typeof refine.distanceM === 'number' && Number.isFinite(refine.distanceM)
        ? refine.distanceM.toFixed(0)
        : '?';
    const acc =
      typeof refine.accuracy === 'number' && Number.isFinite(refine.accuracy)
        ? refine.accuracy.toFixed(0)
        : '?';

    try {
      await openGate(credentials, gate.deviceId);
      await upsertGate({
        ...gate,
        lastOpenedAt: Date.now(),
        lastResult: 'opened',
      });
      await appendEvent({
        kind: 'test_opened',
        gateId: gate.id,
        message: `${label}: test OPENED — ${dist}m ±${acc}m, BT ${btRequired ? 'connected' : 'not required'} · deviceId ${gate.deviceId}`,
        ...geo,
      });
      publishOpenResult(gate.id, label, true, 'Opened successfully');
      await notifyOpenSuccess(label);
    } catch (error) {
      const message = formatOpenApiError(error);
      await appendEvent({
        kind: 'test_error',
        gateId: gate.id,
        message: `${label}: test open failed — ${message} (${dist}m ±${acc}m) · deviceId ${gate.deviceId}`,
        ...geo,
      });
      await patchGate(gate.id, { lastResult: 'error' });
      publishOpenResult(gate.id, label, false, message);
      await notifyOpenFailure(label, message);
    }
  }
}
